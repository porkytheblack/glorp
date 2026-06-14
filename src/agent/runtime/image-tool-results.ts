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
/** User-pasted images persist in history; only the most recent N still travel
 * to the model. Older ones are replaced with a marker — a 400kB screenshot
 * re-sent on every turn of a long session burns context for nothing. */
const MAX_USER_IMAGES_PER_REQUEST = 2;

interface ImagePayload { media_type: string; data: string; }

export function withImageToolResults(model: ModelAdapter): ModelAdapter {
  return {
    get name() { return model.name; },
    setSystemPrompt(sp: string) { model.setSystemPrompt(sp); },
    prompt(request, notify, signal) {
      let messages = injectImageMessages(request.messages);
      messages = capUserImages(messages);
      messages = coalesceMergeableUserMessages(messages);
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

/**
 * Keep only the most recent N user-attached images in the outgoing request;
 * older image parts become a short text marker. Operates on the request copy
 * only — stored history keeps every image, so a later turn can still surface
 * a newer one.
 */
export function capUserImages(messages: Message[]): Message[] {
  const indices: Array<{ msg: number; part: number }> = [];
  messages.forEach((m, mi) => {
    if (m.sender !== "user" || !Array.isArray(m.content)) return;
    m.content.forEach((p, pi) => {
      if (p.type === "image") indices.push({ msg: mi, part: pi });
    });
  });
  if (indices.length <= MAX_USER_IMAGES_PER_REQUEST) return messages;

  const drop = new Set(
    indices.slice(0, indices.length - MAX_USER_IMAGES_PER_REQUEST).map((x) => `${x.msg}:${x.part}`),
  );
  return messages.map((m, mi) => {
    if (m.sender !== "user" || !Array.isArray(m.content)) return m;
    if (!m.content.some((p, pi) => drop.has(`${mi}:${pi}`))) return m;
    return {
      ...m,
      content: m.content.map((p, pi) =>
        drop.has(`${mi}:${pi}`)
          ? ({ type: "text", text: "[earlier attached image omitted to conserve context]" } as ContentPart)
          : p,
      ),
    };
  });
}

/**
 * glove-core's OpenAI-compat adapter merges consecutive user-role messages by
 * STRINGIFYING their content (`prev.content = String(prev.content) + ...`),
 * which turns an array content part — an image — into the literal
 * "[object Object]", silently dropping it. (The Anthropic adapter concatenates
 * arrays losslessly, so it is unaffected.) Our injected image messages — and
 * user-pasted image messages — are array-content user messages, so whenever any
 * user-role message (an inbox-resolved notice, a queued user note, a
 * continuation nudge) immediately follows one, the image is destroyed.
 *
 * Pre-empt that here: coalesce each maximal run of consecutive mergeable user
 * messages (a user-role message that isn't a tool-result message — those format
 * as role "tool" and never merge) into a single user message with a unified
 * content-parts array. We only rewrite a run that actually carries array
 * content, so plain-text turns are left byte-for-byte untouched. glove-core then
 * sees one user message per run and its lossy merge never fires. The result is
 * correct for both adapters (formatContentParts renders mixed text+image parts).
 */
export function coalesceMergeableUserMessages(messages: Message[]): Message[] {
  let changed = false;
  const out: Message[] = [];
  for (let i = 0; i < messages.length; ) {
    if (!isMergeableUser(messages[i])) { out.push(messages[i]); i++; continue; }
    let j = i;
    while (j < messages.length && isMergeableUser(messages[j])) j++;
    const run = messages.slice(i, j);
    if (run.length > 1 && run.some((m) => Array.isArray(m.content) && m.content.length)) {
      out.push(mergeUserRun(run));
      changed = true;
    } else {
      out.push(...run);
    }
    i = j;
  }
  return changed ? out : messages;
}

/** A user-role message glove-core would fold into the previous user message —
 * i.e. anything not from the agent that isn't a (role "tool") tool-result. */
function isMergeableUser(m: Message): boolean {
  return m.sender !== "agent" && !m.tool_results?.length;
}

/** Flatten a run of mergeable user messages into one content-array message,
 * preserving image parts as structured content and plain text as text parts. */
function mergeUserRun(run: Message[]): Message {
  const content: ContentPart[] = [];
  for (const m of run) {
    if (Array.isArray(m.content) && m.content.length) content.push(...m.content);
    else if (m.text) content.push({ type: "text", text: m.text } as ContentPart);
  }
  return { sender: "user", text: "", content };
}
