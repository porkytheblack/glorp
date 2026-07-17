/**
 * Loop breaker: models sometimes wedge into re-issuing the exact same tool
 * call over and over (re-reading a file, re-running a failing command,
 * re-listing a directory), burning tokens and context without new
 * information. This guard watches the trailing run of identical tool calls
 * in the transcript; when the model tries to extend a run of >= 2 with a
 * third identical call, it re-prompts once with a corrective nudge. If the
 * model insists a second time, the call is let through — the guard must
 * never become a loop of its own.
 *
 * Legitimate repeats (re-running tests after an edit) are untouched: any
 * different tool call or real user message in between resets the run.
 */

import type { Message, ModelAdapter, ModelPromptResult, ToolCall } from "glove-core/core";
import { wrap, internalUser, streamingBuffer } from "./model-wrap-shared.ts";

/** Intervene when a new identical call would extend a run of this length. */
const TRIGGER_RUN = 2;

function repetitionNudge(toolName: string, count: number): string {
  return (
    `[internal continuation] You have already issued this exact \`${toolName}\` call with identical arguments ` +
    `${count} times in a row. Repeating it returns the same result and only burns tokens — the result is ` +
    `already in the transcript above. Act on it instead: change the arguments or approach, use a different ` +
    `tool, or if you are genuinely blocked, stop and explain the blocker in plain text. Do not repeat the identical call.`
  );
}

/** Canonical identity for a tool call — name + structurally-sorted args. */
export function callKey(call: ToolCall): string {
  return `${call.tool_name}:${stableStringify(call.input_args)}`;
}

/**
 * Length + key of the run of identical tool calls at the very end of the
 * transcript. Scanning stops at a compaction boundary or a real user message
 * (user-sanctioned retries are not loops).
 */
export function trailingIdenticalRun(messages: Message[]): { key: string; count: number; toolName: string } | null {
  let key: string | null = null;
  let toolName = "";
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.is_compaction || m.is_compaction_request) break;
    if (isRealUserMessage(m)) break;
    const calls = m.tool_calls ?? [];
    for (let j = calls.length - 1; j >= 0; j--) {
      const k = callKey(calls[j]!);
      if (key === null) {
        key = k;
        toolName = calls[j]!.tool_name;
        count = 1;
      } else if (k === key) {
        count++;
      } else {
        return { key, count, toolName };
      }
    }
  }
  return key === null ? null : { key, count, toolName };
}

export function withRepetitionGuard(model: ModelAdapter): ModelAdapter {
  return wrap(model, async (request, notify, signal) => {
    const run = trailingIdenticalRun(request.messages);
    if (!run || run.count < TRIGGER_RUN) return model.prompt(request, notify, signal);

    const { buffered, replayStructural } = streamingBuffer(notify);
    const first = await model.prompt(request, buffered, signal);
    if (signal?.aborted || !resultRepeatsCall(first, run.key)) {
      await replayStructural();
      return first;
    }
    // The model tried the identical call yet again — drop the attempt's tool
    // calls (an unanswered tool_call message would violate strict providers'
    // adjacency contract), keep any narration, and re-prompt with the nudge.
    const messages = [
      ...request.messages,
      ...stripToolCalls(first.messages),
      internalUser(repetitionNudge(run.toolName, run.count)),
    ];
    return model.prompt({ ...request, messages }, notify, signal);
  });
}

function resultRepeatsCall(result: ModelPromptResult, key: string): boolean {
  return result.messages.some((m) => (m.tool_calls ?? []).some((tc) => callKey(tc) === key));
}

/** Keep the attempt's visible narration for the retry, minus the tool calls. */
function stripToolCalls(messages: Message[]): Message[] {
  return messages
    .filter((m) => (m.text ?? "").trim().length > 0)
    .map((m) => ({ ...m, tool_calls: undefined }));
}

/** True for a genuine user turn (not a tool-result carrier or internal nudge). */
function isRealUserMessage(m: Message): boolean {
  if (m.sender === "agent") return false;
  if (m.tool_results?.length) return false;
  if (m.is_skill_injection) return false;
  return (m.text ?? "").trim().length > 0;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}
