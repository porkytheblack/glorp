/**
 * Estimate how full the model's context will be for the NEXT turn, so glorp
 * can trigger glove's early compaction (via the /compact hook) BEFORE quality
 * collapses — observed failure: a 146k-token live window plus a screenshot on
 * a 262k model produced a reasoning-free reply that ignored the user's
 * message entirely. Glove's own threshold compaction fires too late for that.
 */

import type { Message } from "glove-core/core";

/** chars→tokens divisor — rough but consistently conservative for mixed prose/JSON. */
const CHARS_PER_TOKEN = 4;
/** System prompt + tool schemas + session-state injection, roughly. */
const FIXED_OVERHEAD_TOKENS = 70_000;
/** Vision cost per image, order-of-magnitude (provider tiling varies). */
const TOKENS_PER_IMAGE = 2_000;
/** Compact early once the projected request crosses this share of the window. */
const PRESSURE_THRESHOLD = 0.6;

export interface PressureEstimate {
  estimatedTokens: number;
  contextLimit: number;
  pressured: boolean;
}

export function estimateContextPressure(
  messages: Message[],
  contextLimit: number,
  incomingImages = 0,
): PressureEstimate {
  let lastCompaction = -1;
  messages.forEach((m, i) => {
    if (m.is_compaction) lastCompaction = i;
  });
  const live = messages.slice(lastCompaction + 1);

  let chars = 0;
  let images = incomingImages;
  for (const m of live) {
    chars += (m.text ?? "").length;
    if (m.reasoning_content) chars += m.reasoning_content.length;
    for (const tc of m.tool_calls ?? []) chars += JSON.stringify(tc.input_args ?? "").length + 60;
    for (const tr of m.tool_results ?? []) chars += JSON.stringify(tr.result?.data ?? "").length + 60;
    for (const part of m.content ?? []) {
      if (part.type === "image") images += 1;
      else chars += JSON.stringify(part).length;
    }
  }

  const estimatedTokens = Math.round(chars / CHARS_PER_TOKEN) + images * TOKENS_PER_IMAGE + FIXED_OVERHEAD_TOKENS;
  return {
    estimatedTokens,
    contextLimit,
    pressured: contextLimit > 0 && estimatedTokens > contextLimit * PRESSURE_THRESHOLD,
  };
}
