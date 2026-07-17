/** Shared plumbing for model-adapter guard wrappers (model-guards.ts,
 * repetition-guard.ts): the wrap/internal-message/stream-buffer trio. */

import type { Message, ModelAdapter, SubscriberAdapter } from "glove-core/core";

export function wrap(model: ModelAdapter, prompt: ModelAdapter["prompt"]): ModelAdapter {
  return {
    get name() { return model.name; },
    setSystemPrompt(systemPrompt: string) { model.setSystemPrompt(systemPrompt); },
    prompt,
  };
}

export function internalUser(text: string): Message {
  return { sender: "user", text, is_skill_injection: true };
}

/** Forward text_delta immediately for real-time streaming; buffer the rest. */
export function streamingBuffer(notify: SubscriberAdapter["record"]): {
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
