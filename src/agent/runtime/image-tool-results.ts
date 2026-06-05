/**
 * Model-adapter wrapper that makes images the agent loaded with `view_image`
 * visible to the model.
 *
 * glove-core formats tool results as text only (`formatToolResultContent` →
 * `JSON.stringify(data)`), so an image cannot travel back inside a tool
 * result. The only channel the Anthropic adapter renders as a real image is a
 * user-role message's `content[]` (`formatContentParts`). So `view_image`
 * stashes the base64 on `renderData.glorpImage`, and this wrapper — running in
 * glorp's existing model-wrapper chain — splices a synthetic user message with
 * the image content part immediately AFTER the tool-result message that
 * carried it. The adapter merges consecutive user messages, yielding a valid
 * `[tool_result, image]` user turn (tool_result blocks stay first).
 *
 * The synthetic message is only added to the outgoing request — never
 * persisted — so it is re-derived from the stored renderData on every turn and
 * stays consistent across compaction.
 */

import type { ContentPart, Message, ModelAdapter } from "glove-core/core";
import { GLORP_IMAGE_RENDER_KEY } from "../tools/view-image.ts";

/** Cap how many images we re-send per request so context can't balloon. */
const MAX_IMAGES_PER_REQUEST = 4;

interface ImagePayload { media_type: string; data: string; }

export function withImageToolResults(model: ModelAdapter): ModelAdapter {
  return {
    get name() { return model.name; },
    setSystemPrompt(sp: string) { model.setSystemPrompt(sp); },
    prompt(request, notify, signal) {
      const messages = injectImageMessages(request.messages);
      if (messages === request.messages) return model.prompt(request, notify, signal);
      return model.prompt({ ...request, messages }, notify, signal);
    },
  };
}

/**
 * Return a new messages array with image content messages spliced after each
 * tool-result message that carried a `view_image` payload. Returns the input
 * unchanged (same reference) when there is nothing to inject — the fast path.
 */
export function injectImageMessages(messages: Message[]): Message[] {
  const hits = new Map<number, ContentPart[]>();
  messages.forEach((m, i) => {
    const parts = imagePartsFor(m);
    if (parts.length) hits.set(i, parts);
  });
  if (hits.size === 0) return messages;

  // Keep only the most recent N image-bearing results to bound token cost.
  const keep = new Set([...hits.keys()].sort((a, b) => a - b).slice(-MAX_IMAGES_PER_REQUEST));
  const out: Message[] = [];
  for (let i = 0; i < messages.length; i++) {
    out.push(messages[i]);
    if (keep.has(i)) {
      out.push({ sender: "user", text: "", content: hits.get(i)! });
    }
  }
  return out;
}

function imagePartsFor(message: Message): ContentPart[] {
  if (!message.tool_results?.length) return [];
  const parts: ContentPart[] = [];
  for (const tr of message.tool_results) {
    const img = readImagePayload(tr.result);
    if (img) {
      parts.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } });
    }
  }
  return parts;
}

function readImagePayload(result: unknown): ImagePayload | null {
  const rd = (result as { renderData?: Record<string, unknown> } | null | undefined)?.renderData;
  const img = rd?.[GLORP_IMAGE_RENDER_KEY] as Partial<ImagePayload> | undefined;
  if (img && typeof img.media_type === "string" && typeof img.data === "string") {
    return { media_type: img.media_type, data: img.data };
  }
  return null;
}
