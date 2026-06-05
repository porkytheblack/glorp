import type { Message, ModelAdapter, ModelPromptResult, SubscriberAdapter } from "glove-core/core";
import { isAgentSender, isIntentOnlyText } from "./intent-detect.ts";
import { withToolArgRepair } from "./tool-arg-repair.ts";
import { withImageToolResults } from "./image-tool-results.ts";

const TASK_UPDATE_TOOL_NAME = "glove_update_tasks";
const EMPTY_RESPONSE_RETRY_PROMPT =
  "[internal retry] Your previous completion produced no visible answer or tool call. Produce visible text or a tool call now.";
const INTENT_ONLY_CONTINUATION_PROMPT =
  "[internal continuation] You produced only narration (\"Let me…\", \"I'll…\") without calling a tool. Call the tool now — do not describe the action, perform it. If a blocking inbox item is obsolete, first call glove_update_inbox.";
const TASK_UPDATE_CONTINUATION_PROMPT =
  "[internal continuation] You just updated the task list and at least one task is still pending or in_progress. Continue now with the next concrete tool call or, if blocked, state the blocker.";
const TRAILING_TOOL_RESULT_PROMPT =
  "[internal continuation] You produced no follow-up after the last tool result. Ending a turn on a tool result is an anti-pattern — the user is left without a closing message and the TUI shows the agent as still working. Write a short text response now that (a) summarises what the tool result tells you, and (b) either kicks off the next concrete step or states the work is complete with a one-line outcome.";

export function visibleMessageText(message: Message): string {
  const text = message.pre_modified_text ?? message.text ?? "";
  if (text.trim()) return text;
  return (message.content ?? [])
    .map((part) => part.type === "text" ? part.text ?? "" : `[${part.type} attachment]`)
    .filter(Boolean)
    .join("\n");
}

export function isVisibleTranscriptMessage(message: Message): boolean {
  if (message.is_compaction || message.is_compaction_request || message.is_skill_injection) return false;
  if (message.tool_results?.length) return false;
  return visibleMessageText(message).trim().length > 0;
}

export function modelResultHasVisibleAgentOutput(result: ModelPromptResult | Message): boolean {
  const messages = "messages" in result ? result.messages : [result];
  return messages.some((message) => {
    if (!isAgentSender(message.sender)) return false;
    if ((message.tool_calls?.length ?? 0) > 0) return true;
    return visibleMessageText(message).trim().length > 0;
  });
}

export function modelResultHasToolCall(result: ModelPromptResult | Message): boolean {
  const messages = "messages" in result ? result.messages : [result];
  return messages.some((message) => (message.tool_calls?.length ?? 0) > 0);
}

export function modelResultIsIntentOnly(result: ModelPromptResult | Message): boolean {
  if (modelResultHasToolCall(result)) return false;
  const messages = "messages" in result ? result.messages : [result];
  const texts = messages
    .filter((message) => isAgentSender(message.sender))
    .map((message) => visibleMessageText(message).trim())
    .filter(Boolean);
  return texts.length > 0 && texts.every(isIntentOnlyText);
}

export function messageHasOpenTaskUpdate(message: Message | undefined): boolean {
  return (message?.tool_results ?? []).some((toolResult) => {
    if (toolResult.tool_name.toLowerCase() !== TASK_UPDATE_TOOL_NAME) return false;
    if (toolResult.result.status !== "success") return false;
    const tasks = (toolResult.result.data as { tasks?: unknown } | undefined)?.tasks;
    return Array.isArray(tasks) && tasks.some((task) =>
      !!task && typeof task === "object" && (task as { status?: unknown }).status !== "completed"
    );
  });
}

export function withEmptyResponseRetry(model: ModelAdapter): ModelAdapter {
  return wrap(model, async (request, notify, signal) => {
    const first = await model.prompt(request, notify, signal);
    if (signal?.aborted || modelResultHasVisibleAgentOutput(first)) return first;
    return model.prompt({ ...request, messages: [...request.messages, internalUser(EMPTY_RESPONSE_RETRY_PROMPT)] }, notify, signal);
  });
}

/** If the model ends on a tool result with no follow-up text, retry once asking for a wrap-up. */
export function withTrailingToolResultGuard(model: ModelAdapter): ModelAdapter {
  return wrap(model, async (request, notify, signal) => {
    if (!latestMessageHasToolResults(request.messages)) {
      return model.prompt(request, notify, signal);
    }
    const { buffered, replayStructural } = streamingBuffer(notify);
    const first = await model.prompt(request, buffered, signal);
    if (signal?.aborted) {
      await replayStructural();
      return first;
    }
    if (modelResponseHasVisibleText(first) || modelResponseIsToolOnly(first)) {
      await replayStructural();
      return first;
    }
    // Empty response after a tool result — actively ask for a wrap-up.
    return model.prompt(
      { ...request, messages: [...request.messages, internalUser(TRAILING_TOOL_RESULT_PROMPT)] },
      notify,
      signal,
    );
  });
}

function latestMessageHasToolResults(messages: Message[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    if (m.is_compaction || m.is_compaction_request || m.is_skill_injection) continue;
    return (m.tool_results?.length ?? 0) > 0;
  }
  return false;
}

function modelResponseHasVisibleText(result: ModelPromptResult): boolean {
  return result.messages.some((m) => isAgentSender(m.sender) && visibleMessageText(m).trim().length > 0);
}

function modelResponseIsToolOnly(result: ModelPromptResult): boolean {
  const agent = result.messages.filter((m) => isAgentSender(m.sender));
  if (agent.length === 0) return false;
  return agent.every(
    (m) => (m.tool_calls?.length ?? 0) > 0 && visibleMessageText(m).trim().length === 0,
  );
}

export function withIntentOnlyContinuation(model: ModelAdapter): ModelAdapter {
  const MAX_RETRIES = 2;
  return wrap(model, async (request, notify, signal) => {
    let msgs = request.messages;
    for (let i = 0; i < MAX_RETRIES; i++) {
      const { buffered, replayStructural } = streamingBuffer(notify);
      const result = await model.prompt({ ...request, messages: msgs }, buffered, signal);
      if (signal?.aborted || !modelResultIsIntentOnly(result)) {
        await replayStructural();
        return result;
      }
      // Include the model's narration in context so the retry sees what it said
      msgs = [...msgs, ...result.messages, internalUser(INTENT_ONLY_CONTINUATION_PROMPT)];
    }
    // All buffered retries exhausted; final attempt goes unbuffered
    return model.prompt({ ...request, messages: msgs }, notify, signal);
  });
}

export function withTaskUpdateContinuation(model: ModelAdapter): ModelAdapter {
  return wrap(model, async (request, notify, signal) => {
    if (!messageHasOpenTaskUpdate(request.messages.at(-1))) return model.prompt(request, notify, signal);
    const { buffered, replayStructural } = streamingBuffer(notify);
    const first = await model.prompt(request, buffered, signal);
    if (signal?.aborted || modelResultHasToolCall(first)) {
      await replayStructural();
      return first;
    }
    return model.prompt({ ...request, messages: [...request.messages, internalUser(TASK_UPDATE_CONTINUATION_PROMPT)] }, notify, signal);
  });
}

export function wrapGlorpModel(model: ModelAdapter): ModelAdapter {
  return withIntentOnlyContinuation(
    withTaskUpdateContinuation(
      withTrailingToolResultGuard(
        withEmptyResponseRetry(withToolArgRepair(withImageToolResults(model))),
      ),
    ),
  );
}

function wrap(model: ModelAdapter, prompt: ModelAdapter["prompt"]): ModelAdapter {
  return {
    get name() { return model.name; },
    setSystemPrompt(systemPrompt: string) { model.setSystemPrompt(systemPrompt); },
    prompt,
  };
}

function internalUser(text: string): Message {
  return { sender: "user", text, is_skill_injection: true };
}

/** Forward text_delta immediately for real-time streaming; buffer the rest. */
function streamingBuffer(notify: SubscriberAdapter["record"]): {
  buffered: SubscriberAdapter["record"];
  replayStructural: () => Promise<void>;
} {
  const structural: Array<{ eventType: string; data: unknown }> = [];
  return {
    buffered: async (eventType, data) => {
      if (eventType === "text_delta") {
        await notify(eventType, data);
      } else {
        structural.push({ eventType: eventType as string, data });
      }
    },
    async replayStructural() {
      for (const e of structural) await notify(e.eventType as any, e.data as any);
    },
  };
}

export { isIntentOnlyText } from "./intent-detect.ts";
