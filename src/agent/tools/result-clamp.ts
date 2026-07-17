/**
 * Last-line-of-defense cap on tool result size, applied to EVERY tool folded
 * onto the agent (built-ins, MCP-bridged, context/resource tools). Individual
 * tools truncate at the source where they can be smart about it (bash keeps
 * head+tail of streams, read paginates); this clamp catches everything they
 * miss — minified single-line files, unbounded MCP server responses, huge
 * JSON payloads — so no single tool call can flood the context window and
 * leave the model without room to reason.
 */

import type { GloveFoldArgs } from "glove-core/glove";
import type { ToolResultData } from "glove-core/core";

/** ~25k tokens at the conservative 4-chars/token estimate context-pressure uses. */
export const MAX_TOOL_RESULT_CHARS = 100_000;
/** Keep the start (usually the most relevant part)… */
const HEAD_CHARS = 80_000;
/** …plus the end (totals, exit summaries, closing context). */
const TAIL_CHARS = 15_000;
/** Error messages ride next to data in the same context — cap them too. */
const MAX_MESSAGE_CHARS = 10_000;

/** Head+tail truncation with an actionable elision marker. */
export function clampText(text: string, max = MAX_TOOL_RESULT_CHARS): string {
  if (text.length <= max) return text;
  const headBudget = Math.floor(max * (HEAD_CHARS / MAX_TOOL_RESULT_CHARS));
  const tailBudget = Math.floor(max * (TAIL_CHARS / MAX_TOOL_RESULT_CHARS));
  const elided = text.length - headBudget - tailBudget;
  return (
    text.slice(0, headBudget) +
    `\n... [tool result clamped: ${elided} of ${text.length} chars elided. ` +
    `Re-run with narrower queries, offset/limit paging, or targeted reads to see the elided middle.]\n` +
    text.slice(text.length - tailBudget)
  );
}

/**
 * Clamp the model-visible fields of a tool result. `data` and `message` are
 * what glove serializes into the transcript; `renderData` (UI cards, image
 * payloads), `summary`, and `generateSummaryArgs` never reach the model as-is
 * and are left untouched.
 */
export function clampToolResultData(result: ToolResultData, max = MAX_TOOL_RESULT_CHARS): ToolResultData {
  let out = result;
  if (typeof result.data === "string" && result.data.length > max) {
    out = { ...out, data: clampText(result.data, max) };
  } else if (result.data !== null && typeof result.data === "object") {
    const serialized = safeStringify(result.data);
    if (serialized.length > max) {
      out = {
        ...out,
        data:
          "[structured tool result too large to inline — serialized form below]\n" +
          clampText(serialized, max),
      };
    }
  }
  if (typeof result.message === "string" && result.message.length > MAX_MESSAGE_CHARS) {
    out = { ...out, message: clampText(result.message, MAX_MESSAGE_CHARS) };
  }
  return out;
}

/** Wrap a tool so everything its `do` returns passes through the clamp. */
export function withResultClamp<I>(tool: GloveFoldArgs<I>, max = MAX_TOOL_RESULT_CHARS): GloveFoldArgs<I> {
  return {
    ...tool,
    async do(input, display, glove, signal) {
      return clampToolResultData(await tool.do(input, display, glove, signal), max);
    },
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
