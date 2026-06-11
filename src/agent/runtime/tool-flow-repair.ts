/**
 * Tool-flow repair: normalize a message history so every assistant message
 * with `tool_calls` is immediately followed by exactly its tool results.
 *
 * An aborted or errored turn can leave dangling tool calls; a later user
 * message ("continue") then wedges between calls and their late-arriving
 * results. Strict providers (Moonshot Kimi, DeepSeek) reject such replays —
 * "an assistant message with 'tool_calls' must be followed by tool messages".
 *
 * Rules, in order:
 *   1. Results are re-homed to sit directly after their calling message.
 *   2. Calls whose result never arrived get a synthetic interrupted-error
 *      result so the pair is complete.
 *   3. Orphaned results (no matching call anywhere) are dropped.
 * The function is pure and idempotent — already-clean histories pass through
 * structurally unchanged.
 */

import type { Message } from "glove-core/core";

const INTERRUPTED_RESULT = {
  status: "error" as const,
  data: "Tool run was interrupted before completing — no result available.",
};

type ToolResultEntry = NonNullable<Message["tool_results"]>[number];

export function repairToolFlow(messages: Message[]): Message[] {
  // Index every result by call id (first occurrence wins) and every call id.
  const pool = new Map<string, ToolResultEntry>();
  const callIds = new Set<string>();
  for (const m of messages) {
    for (const r of m.tool_results ?? []) {
      const id = r.call_id;
      if (id && !pool.has(id)) pool.set(id, r);
    }
    for (const c of m.tool_calls ?? []) if (c.id) callIds.add(c.id);
  }

  const out: Message[] = [];
  for (const m of messages) {
    if (m.tool_results?.length) {
      // Keep only results not re-homed next to their call (i.e. orphans whose
      // call id exists nowhere — those are dropped) and preserve any text.
      const remaining = m.tool_results.filter((r) => r.call_id && pool.has(r.call_id) && callIds.has(r.call_id));
      if (remaining.length > 0) {
        // A results message whose call hasn't been seen yet (results BEFORE
        // the call — shouldn't happen, but stay safe): leave in place.
        out.push({ ...m, tool_results: remaining });
        for (const r of remaining) pool.delete(r.call_id!);
      } else if (m.text?.trim()) {
        out.push({ ...m, tool_results: undefined });
      }
      continue;
    }

    out.push(m);

    if (m.sender === "agent" && m.tool_calls?.length) {
      const results: ToolResultEntry[] = m.tool_calls.map((tc) => {
        const pooled = tc.id ? pool.get(tc.id) : undefined;
        if (pooled && tc.id) {
          pool.delete(tc.id);
          return pooled;
        }
        return { tool_name: tc.tool_name, call_id: tc.id ?? `${tc.tool_name}:repaired`, result: { ...INTERRUPTED_RESULT } };
      });
      out.push({ sender: "user", text: "", tool_results: results } as Message);
    }
  }
  return out;
}

/** True when the history already satisfies the adjacency contract — used to
 * skip rewrites (and dirty-flag churn) on the happy path. */
export function toolFlowIsClean(messages: Message[]): boolean {
  const repaired = repairToolFlow(messages);
  if (repaired.length !== messages.length) return false;
  return repaired.every((m, i) => {
    const orig = messages[i]!;
    const a = (m.tool_results ?? []).map((r) => r.call_id).join(",");
    const b = (orig.tool_results ?? []).map((r) => r.call_id).join(",");
    return m === orig || (m.sender === orig.sender && a === b);
  });
}
