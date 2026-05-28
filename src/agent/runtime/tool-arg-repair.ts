/**
 * Heuristic repair for malformed tool-call arguments from model streaming.
 *
 * Two failure modes:
 * 1. Truncation — model hits max_tokens mid-argument, leaving unclosed JSON.
 * 2. Bad escaping — some providers don't double-escape quotes inside the
 *    streamed `arguments` string, leaving bare `"` inside string values.
 *
 * Repair pipeline:  JSON.parse  →  close truncation  →  re-escape quotes  →  both
 */

import type { ModelAdapter, ModelPromptResult } from "glove-core/core";

/** Try JSON.parse, then heuristic repairs, then give up and return raw. */
export function repairJsonArgs(raw: unknown): unknown {
  if (raw == null || typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return raw;

  try { return JSON.parse(trimmed); } catch { /* needs repair */ }

  // Attempt 1: close truncated JSON (most common with large tool args)
  const closed = closeTruncated(trimmed);
  if (closed !== trimmed) {
    try { return JSON.parse(closed); } catch { /* try next */ }
  }

  // Attempt 2: re-escape bare quotes
  const reescaped = reescapeQuotes(trimmed);
  try { return JSON.parse(reescaped); } catch { /* try next */ }

  // Attempt 3: re-escape then close
  const both = closeTruncated(reescaped);
  if (both !== reescaped) {
    try { return JSON.parse(both); } catch { /* give up */ }
  }

  return raw;
}

// ---------------------------------------------------------------------------
// Truncation repair
// ---------------------------------------------------------------------------

/**
 * Walk the string tracking JSON nesting. If it ends mid-value, close
 * the open string, then close all open braces/brackets.
 */
function closeTruncated(src: string): string {
  let inStr = false;
  let esc = false;
  const stack: string[] = [];          // tracks { and [

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = false; }
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") { stack.push("}"); continue; }
    if (ch === "[") { stack.push("]"); continue; }
    if (ch === "}" || ch === "]") { stack.pop(); continue; }
  }

  if (!inStr && stack.length === 0) return src;     // already balanced

  let suffix = "";
  // If we ended mid-escape, drop the trailing backslash
  if (esc) { src = src.slice(0, -1); }
  // If we ended inside a string, close it
  if (inStr) { suffix += '"'; }
  // Close all open containers outermost-last
  while (stack.length > 0) suffix += stack.pop();

  return src + suffix;
}

// ---------------------------------------------------------------------------
// Quote re-escaping
// ---------------------------------------------------------------------------

function reescapeQuotes(src: string): string {
  const out: string[] = [];
  let inStr = false;
  let esc = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (esc) { out.push(ch); esc = false; continue; }
    if (ch === "\\") { out.push(ch); esc = true; continue; }

    if (ch === '"') {
      if (!inStr) { inStr = true; out.push(ch); }
      else if (isStructuralFollow(src, i + 1)) { inStr = false; out.push(ch); }
      else { out.push('\\"'); }
      continue;
    }

    if (inStr && ch === "\n") { out.push("\\n"); continue; }
    if (inStr && ch === "\r") { out.push("\\r"); continue; }
    if (inStr && ch === "\t") { out.push("\\t"); continue; }

    out.push(ch);
  }
  return out.join("");
}

/** After a closing `"`, structural JSON is `:` `,` `}` `]`. */
function isStructuralFollow(src: string, pos: number): boolean {
  for (let j = pos; j < src.length; j++) {
    const c = src[j];
    if (c === " " || c === "\n" || c === "\r" || c === "\t") continue;
    return c === ":" || c === "," || c === "}" || c === "]";
  }
  return true; // end of string → structural
}

// ---------------------------------------------------------------------------
// Model wrapper
// ---------------------------------------------------------------------------

export function withToolArgRepair(model: ModelAdapter): ModelAdapter {
  return {
    get name() { return model.name; },
    setSystemPrompt(s: string) { model.setSystemPrompt(s); },
    async prompt(request, notify, signal) {
      const result: ModelPromptResult = await model.prompt(request, notify, signal);
      repairResult(result);
      return result;
    },
  };
}

function repairResult(result: ModelPromptResult): void {
  for (const msg of result.messages) {
    if (!msg.tool_calls) continue;
    for (const tc of msg.tool_calls) {
      if (typeof tc.input_args === "string") {
        tc.input_args = repairJsonArgs(tc.input_args);
      }
    }
  }
}
