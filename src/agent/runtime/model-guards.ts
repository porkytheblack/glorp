import type { Message, ModelAdapter, ModelPromptResult, SubscriberAdapter } from "glove-core/core";

const TASK_UPDATE_TOOL_NAME = "glove_update_tasks";
const EMPTY_RESPONSE_RETRY_PROMPT =
  "[internal retry] Your previous completion produced no visible answer or tool call. Produce visible text or a tool call now.";
const INTENT_ONLY_CONTINUATION_PROMPT =
  "[internal continuation] Your previous completion only stated an intention to continue. Continue now with the concrete next tool call. If a blocking inbox item is obsolete, first call glove_update_inbox.";
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
    if (message.sender !== "agent") return false;
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
    .filter((message) => message.sender === "agent")
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

/**
 * Block the "agent ends on a tool result" anti-pattern. When the most
 * recent message in the prompt is a tool result (the loop just executed
 * tools), the model MUST emit at least one user-visible text run — either
 * a summary of what the tool said or a clear handoff to the next step.
 *
 * Without this, the UI sees the tool result land and the agent go silent
 * — looks like a freeze, and reading the transcript later there's no
 * narrative tying the tool outputs to a decision. We buffer the first
 * attempt's events; if the model produced ONLY tool calls (no text) AND
 * there is no further tool work pending, ask for the text wrap-up and
 * use whatever the model returns on the retry.
 */
export function withTrailingToolResultGuard(model: ModelAdapter): ModelAdapter {
  return wrap(model, async (request, notify, signal) => {
    if (!latestMessageHasToolResults(request.messages)) {
      return model.prompt(request, notify, signal);
    }
    const events: Array<{ eventType: string; data: unknown }> = [];
    const buffered: SubscriberAdapter["record"] = async (eventType, data) => {
      events.push({ eventType: eventType as string, data });
    };
    const first = await model.prompt(request, buffered, signal);
    if (signal?.aborted) {
      await replay(notify, events);
      return first;
    }
    // If the first response includes ANY visible text, we're good — replay
    // the buffered events and return. If it only contains tool calls, that
    // is fine too: the loop will execute those and we'll get a chance to
    // wrap up later on the resulting prompt.
    if (modelResponseHasVisibleText(first) || modelResponseIsToolOnly(first)) {
      await replay(notify, events);
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
  return result.messages.some((m) => m.sender === "agent" && visibleMessageText(m).trim().length > 0);
}

function modelResponseIsToolOnly(result: ModelPromptResult): boolean {
  const agent = result.messages.filter((m) => m.sender === "agent");
  if (agent.length === 0) return false;
  return agent.every(
    (m) => (m.tool_calls?.length ?? 0) > 0 && visibleMessageText(m).trim().length === 0,
  );
}

export function withIntentOnlyContinuation(model: ModelAdapter): ModelAdapter {
  return wrap(model, async (request, notify, signal) => {
    const events: Array<{ eventType: string; data: unknown }> = [];
    const buffered: SubscriberAdapter["record"] = async (eventType, data) => {
      events.push({ eventType: eventType as string, data });
    };
    const first = await model.prompt(request, buffered, signal);
    if (signal?.aborted || !modelResultIsIntentOnly(first)) {
      await replay(notify, events);
      return first;
    }
    return model.prompt({ ...request, messages: [...request.messages, internalUser(INTENT_ONLY_CONTINUATION_PROMPT)] }, notify, signal);
  });
}

export function withTaskUpdateContinuation(model: ModelAdapter): ModelAdapter {
  return wrap(model, async (request, notify, signal) => {
    if (!messageHasOpenTaskUpdate(request.messages.at(-1))) return model.prompt(request, notify, signal);
    const events: Array<{ eventType: string; data: unknown }> = [];
    const buffered: SubscriberAdapter["record"] = async (eventType, data) => {
      events.push({ eventType: eventType as string, data });
    };
    const first = await model.prompt(request, buffered, signal);
    if (signal?.aborted || modelResultHasToolCall(first)) {
      await replay(notify, events);
      return first;
    }
    return model.prompt({ ...request, messages: [...request.messages, internalUser(TASK_UPDATE_CONTINUATION_PROMPT)] }, notify, signal);
  });
}

export function wrapGlorpModel(model: ModelAdapter): ModelAdapter {
  return withIntentOnlyContinuation(
    withTaskUpdateContinuation(
      withTrailingToolResultGuard(withEmptyResponseRetry(model)),
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

async function replay(notify: SubscriberAdapter["record"], events: Array<{ eventType: string; data: unknown }>) {
  for (const event of events) await notify(event.eventType as any, event.data as any);
}

function isIntentOnlyText(text: string): boolean {
  const normalized = text.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return false;
  const verbs = "(?:start|begin|check|inspect|look|read|open|review|edit|update|patch|fix|run|test|verify|investigate|continue|proceed|work|implement|make|add|wire|trace|debug|rewrite|write|create|generate|build|validate|resolve)";
  const gerunds = "(?:checking|inspecting|reading|opening|reviewing|editing|updating|patching|fixing|running|testing|verifying|investigating|continuing|proceeding|implementing|adding|wiring|tracing|debugging|rewriting|writing|creating|generating|building|validating|resolving)";
  return [
    new RegExp(`\\bi'll\\s+${verbs}\\b`),
    new RegExp(`\\bi will\\s+${verbs}\\b`),
    new RegExp(`\\bi'm going to\\s+${verbs}\\b`),
    new RegExp(`\\bi can\\s+${verbs}\\b`),
    new RegExp(`\\blet me\\s+${verbs}\\b`),
    new RegExp(`\\bnext,?\\s+i(?:'ll| will)\\s+${verbs}\\b`),
    new RegExp(`\\bnow\\s+i(?:'ll| will)\\s+${verbs}\\b`),
    new RegExp(`^${gerunds}\\b`),
    new RegExp(`\\b${gerunds}\\s+(?:now|next|the|this|with|using)\\b`),
  ].some((pattern) => pattern.test(normalized));
}
