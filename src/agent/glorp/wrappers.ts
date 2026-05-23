import type { ModelAdapter, SubscriberAdapter } from "glove-core/core";
import {
  modelResultHasToolCall,
  modelResultHasVisibleAgentOutput,
  modelResultIsIntentOnly,
  messageHasOpenTaskUpdate,
} from "./messages.ts";
import {
  EMPTY_RESPONSE_RETRY_PROMPT,
  INTENT_ONLY_CONTINUATION_PROMPT,
  TASK_UPDATE_PROMPT,
  TASK_UPDATE_TOOL_NAME,
} from "./types.ts";

/**
 * Re-prompt the model once when it returns nothing visible. Bails on
 * abort. Used as the outermost wrapper so it sees the final result of
 * every other wrapper below.
 */
export function withEmptyResponseRetry(model: ModelAdapter): ModelAdapter {
  return wrap(model, async (request, notify, signal) => {
    const first = await model.prompt(request, notify, signal);
    if (signal?.aborted || modelResultHasVisibleAgentOutput(first)) return first;
    return model.prompt(
      {
        ...request,
        messages: [...request.messages, { sender: "user", text: EMPTY_RESPONSE_RETRY_PROMPT }],
      },
      notify,
      signal,
    );
  });
}

/**
 * Re-prompt when the model returns only "I'll do X" text without a tool
 * call. Buffers events from the discarded first attempt so we don't emit
 * UI noise that gets replaced moments later.
 */
export function withIntentOnlyContinuation(model: ModelAdapter): ModelAdapter {
  return wrap(model, async (request, notify, signal) => {
    const buffered: Array<{ eventType: string; data: unknown }> = [];
    const bufferNotify: SubscriberAdapter["record"] = async (eventType, data) => {
      buffered.push({ eventType: eventType as string, data });
    };
    const first = await model.prompt(request, bufferNotify, signal);
    if (signal?.aborted || !modelResultIsIntentOnly(first)) {
      await replay(notify, buffered);
      return first;
    }
    return model.prompt(
      {
        ...request,
        messages: [...request.messages, { sender: "user", text: INTENT_ONLY_CONTINUATION_PROMPT, is_skill_injection: true }],
      },
      notify,
      signal,
    );
  });
}

/**
 * After a `glove_update_tasks` call with open tasks, re-prompt when the
 * model didn't follow up with another tool call. Prevents the agent
 * from treating bookkeeping as the end of a turn.
 */
export function withTaskUpdateContinuation(model: ModelAdapter): ModelAdapter {
  return wrap(model, async (request, notify, signal) => {
    if (!messageHasOpenTaskUpdate(request.messages.at(-1), TASK_UPDATE_TOOL_NAME)) {
      return model.prompt(request, notify, signal);
    }
    const buffered: Array<{ eventType: string; data: unknown }> = [];
    const bufferNotify: SubscriberAdapter["record"] = async (eventType, data) => {
      buffered.push({ eventType: eventType as string, data });
    };
    const first = await model.prompt(request, bufferNotify, signal);
    if (signal?.aborted || modelResultHasToolCall(first)) {
      await replay(notify, buffered);
      return first;
    }
    return model.prompt(
      {
        ...request,
        messages: [...request.messages, { sender: "user", text: TASK_UPDATE_PROMPT, is_skill_injection: true }],
      },
      notify,
      signal,
    );
  });
}

/** Compose every wrapper in canonical order. */
export function wrapGlorpModel(model: ModelAdapter): ModelAdapter {
  return withIntentOnlyContinuation(withTaskUpdateContinuation(withEmptyResponseRetry(model)));
}

type Prompt = ModelAdapter["prompt"];

function wrap(model: ModelAdapter, prompt: Prompt): ModelAdapter {
  return {
    get name() {
      return model.name;
    },
    setSystemPrompt(systemPrompt: string) {
      model.setSystemPrompt(systemPrompt);
    },
    prompt,
  };
}

async function replay(
  notify: SubscriberAdapter["record"],
  events: Array<{ eventType: string; data: unknown }>,
): Promise<void> {
  for (const event of events) {
    await notify(event.eventType as any, event.data as any);
  }
}
