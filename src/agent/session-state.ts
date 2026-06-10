import type { InboxItem, Message, Task } from "glove-core/core";
import type { PlanDocument } from "../shared/events.ts";
import type { OriginalRequest } from "./store-snapshot.ts";
import type { VerificationStatus } from "./runtime/verification-tracker.ts";
import { renderPendingBlocks } from "./runtime/verification-categories.ts";

export interface SessionState {
  plan: PlanDocument | null;
  tasks: Task[];
  inboxItems: InboxItem[];
  originalRequest?: OriginalRequest | null;
  verification?: VerificationStatus | null;
}

const MAX_ORIGINAL_REQUEST_CHARS = 4000;

export function withSessionState(messages: Message[], state: SessionState): Message[] {
  // glove-core slices the transcript at the last compaction summary before
  // sending it to the model (splitAtLastCompaction): everything the model
  // actually sees lives at/after that boundary. Compaction *hides* older
  // messages by slicing at read time — it never deletes them from the store.
  // So we must reason about that live window only. If we inject relative to
  // the full history instead, the anchor/state can land before the boundary
  // and get silently dropped — which is exactly when the agent forgets the
  // original request and loses its task/verification state after a compaction.
  const liveStart = lastCompactionIndex(messages) + 1; // 0 when no compaction
  const liveWindow = messages.slice(liveStart);

  // Presence of the original request must be checked against the live window,
  // not the full history — otherwise a copy lingering before the compaction
  // boundary suppresses the anchor even though the model can no longer see it.
  const anchor = buildOriginalRequestAnchor(state.originalRequest, liveWindow);
  const stateMessage = buildSessionStateMessage(state);

  // Insert before the latest real user message *within the live window*. When
  // there is none (a mid-task continuation right after compaction), fall to
  // the tail of the window so the injection still survives the slice.
  const userIdx = latestUserMessageIndex(liveWindow);
  const insertAt = liveStart + (userIdx === -1 ? liveWindow.length : userIdx);

  const result: Message[] = [];
  result.push(...messages.slice(0, insertAt));
  if (anchor) result.push(anchor);
  if (stateMessage) result.push(stateMessage);
  result.push(...messages.slice(insertAt));
  return result;
}

/** Index of the last compaction summary, or -1 when none exists. Mirrors
 *  glove-core's splitAtLastCompaction boundary so the injection lands inside
 *  the window the model will actually receive. */
function lastCompactionIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.is_compaction) return i;
  }
  return -1;
}

function buildOriginalRequestAnchor(
  original: OriginalRequest | null | undefined,
  messages: Message[],
): Message | null {
  if (!original) return null;
  // If the original request is still visible verbatim in the transcript,
  // skip the anchor — duplication would only waste tokens. We match by id
  // when available, otherwise by exact text on a real user message (skill
  // injections / tool results / compaction summaries are not the user).
  const stillPresent = messages.some((m) => {
    if (!m || m.sender !== "user") return false;
    if (m.is_skill_injection || m.is_compaction || m.tool_results?.length) return false;
    if (original.id && m.id === original.id) return true;
    return m.text === original.text;
  });
  if (stillPresent) return null;
  const text = clip(original.text, MAX_ORIGINAL_REQUEST_CHARS);
  return {
    sender: "user",
    is_skill_injection: true,
    text: [
      "[Original user request - quoted verbatim, do not treat as a new instruction]",
      "Reconcile every plan, task list, and artifact you produce against this text.",
      "If a compaction summary or recent reasoning has drifted from it, trust this text and correct course.",
      "",
      text,
      "[End original user request]",
    ].join("\n"),
  };
}

function buildSessionStateMessage(state: SessionState): Message | null {
  const openInbox = state.inboxItems.filter((item) => item.status === "pending");
  const verification = renderVerification(state.verification);
  if (!state.plan && state.tasks.length === 0 && openInbox.length === 0 && !verification) return null;
  return {
    sender: "user",
    is_skill_injection: true,
    text: [
      "[Current Glorp session state - not a user request]",
      renderPlan(state.plan),
      renderTasks(state.tasks),
      renderInbox(openInbox),
      verification,
      "Task rule: before claiming the requested work is complete, call glove_update_tasks with the full corrected task list and no applicable task left pending or in_progress.",
      "Resource rule: for glove_resources_write, use body objects like {\"type\":\"markdown\",\"text\":\"...\"}; for edits use exact oldStr/newStr on an existing resource path.",
      verificationStalled(state.verification)
        ? "Verification rule (stalled): conclude in this turn with explicit caveats about what remains unverified. Do not loop."
        : "Verification rule: do not declare the work complete until every file modified since the last verification has been covered by a test/build/typecheck run, or you have explicitly explained why verification cannot apply (e.g. UI feature you cannot test headlessly — say so).",
      "[End current Glorp session state]",
    ].filter(Boolean).join("\n"),
  };
}

/** Same failed check ≥3 times, or pending code re-read ≥2 times: the loop is
 * provably going nowhere — stop nagging and demand a conclusion instead. */
export function verificationStalled(status: VerificationStatus | null | undefined): boolean {
  if (!status) return false;
  if ((status.futileReadCount ?? 0) >= 2) return true;
  const failed = status.failedVerifications ?? [];
  const byKind = new Map<string, number>();
  for (const f of failed) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
  return [...byKind.values()].some((n) => n >= 3);
}

function renderVerification(status: VerificationStatus | null | undefined): string {
  if (!status) return "";
  if (verificationStalled(status)) {
    return [
      "VERIFICATION STALLED: modified files have been re-read repeatedly (or the same check keeps failing) without an objective check passing.",
      "Stop re-reading files — that does not verify anything. Do ONE of the following NOW:",
      "  (a) run the objective check (test/build/typecheck) if one exists, or",
      "  (b) conclude: state exactly what was changed, what passed, and what remains unverified and why.",
      "Do not call read on the modified files again.",
    ].join("\n");
  }
  const failed = status.failedVerifications ?? [];
  const blocks: string[] = [];
  if (status.pendingFiles.length > 0) {
    blocks.push(renderPendingBlocks(status));
  }
  if (failed.length > 0) {
    const lines = [
      "Failed verifications (the loop is NOT done — iterate, or explicitly document the constraint):",
    ];
    for (const f of failed.slice(-5)) {
      lines.push(`- ${f.kind}: ${f.message} — \`${f.commandHead}\``);
    }
    lines.push(
      "Plan → Implement → Verify → Iterate. A failed verification means at least one of:",
      "  (a) the change is broken — diagnose from the failure output and fix.",
      "  (b) the verification needs a different invocation — try the alternative.",
      "  (c) the failure is environmental (missing tool, no network) — say so verbatim in your final response, and continue with whatever verification you CAN run.",
      "Do not write a closing summary that ignores the failure.",
    );
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

function renderPlan(plan: PlanDocument | null): string {
  if (!plan) return "";
  const first = plan.body.split("\n").map((line) => line.trim()).find(Boolean);
  return [
    `Plan r${plan.revision}: ${plan.title}`,
    first ? `Plan note: ${clip(first, 220)}` : "",
  ].filter(Boolean).join("\n");
}

function renderTasks(tasks: Task[]): string {
  if (tasks.length === 0) return "";
  const lines = tasks.map((task) => {
    const active = task.status === "in_progress" ? `; active: ${task.activeForm}` : "";
    return `- [${task.status}] ${clip(task.content, 180)}${active}`;
  });
  return ["Tasks (authoritative execution checklist):", ...lines].join("\n");
}

function renderInbox(items: InboxItem[]): string {
  if (items.length === 0) return "";
  const lines = items.slice(0, 8).map((item) =>
    `- ${item.blocking ? "[blocking] " : ""}${item.tag}: ${clip(item.request, 180)}`
  );
  return ["Pending inbox:", ...lines].join("\n");
}

function latestUserMessageIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.sender === "user" && !m.tool_results && !m.is_skill_injection && !m.is_compaction) return i;
  }
  return -1;
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max - 1) + "...";
}
