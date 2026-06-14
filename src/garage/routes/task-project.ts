/**
 * Projecting a Task from its worker session. A task stores almost nothing — its
 * status, result, questions, and files are all derived live, here, from the
 * session (+ the agent's declared deliverable on disk) on every read.
 */

import * as path from "node:path";
import type { GarageSession } from "../session.ts";
import type { GarageConfig } from "../config.ts";
import type { TaskRecord } from "../task-store.ts";
import type { DisplaySlotEvent } from "../../shared/events.ts";
import type { TaskDto, TaskStatus, TaskQuestion, TaskFile, TaskResult } from "../contract.ts";
import { resolveSessionPaths } from "../../agent/session-paths.ts";
import { readDeliveredResult, readProgressNote, type DeliveredResult } from "../../agent/task-sink.ts";
import { turnsFromMessages } from "../../agent/runtime/hydrate.ts";
import { walk } from "./files.ts";
import * as fs from "node:fs";

/** A session is considered abandoned (→ failed) if it never appears this long. */
const SESSION_GRACE_MS = 10 * 60 * 1000;

export interface StatusSignals {
  provisionError: string | null | undefined;
  hasSession: boolean;
  ageMs: number;
  sessionError: string | null;
  openQuestionCount: number;
  busy: boolean;
  lastError: string | null;
  turnCount: number;
  /** A declared deliverable exists, or an agent turn is on disk. */
  hasOutput: boolean;
  /** A deferred-start task is provisioned but its first turn is still withheld. */
  startPending: boolean;
}

/** Pure status projection — the single source of truth for a task's lifecycle. */
export function projectStatus(s: StatusSignals): TaskStatus {
  if (s.provisionError) return "failed";
  if (!s.hasSession) return s.ageMs > SESSION_GRACE_MS ? "failed" : "queued";
  if (s.sessionError) return "failed";
  // Provisioned, but the caller asked us to hold the first turn (defer_start):
  // surface that we're waiting on `start` so uploads can land first.
  if (s.startPending) return "staged";
  if (s.openQuestionCount > 0) return "needs_input"; // precedence over busy (G1)
  if (s.busy) return "working";
  if (s.lastError && s.turnCount > 0) return "failed";
  if (s.hasOutput) return "completed";
  return "working"; // session exists, no output yet — the first turn is in flight
}

/** Map an open display slot to a consumer-facing question. */
export function toQuestion(slot: DisplaySlotEvent): TaskQuestion {
  const input = (slot.input ?? {}) as Record<string, unknown>;
  const kind =
    slot.renderer === "select_one" ? "choice"
    : slot.renderer === "confirm" ? "confirm"
    : slot.renderer === "info" ? "info"
    : "text";
  const prompt = String(input.question ?? input.message ?? "The agent needs a response");
  const q: TaskQuestion = { id: slot.slotId, kind, prompt };
  if (kind === "choice" && Array.isArray(input.options)) {
    q.options = (input.options as Array<Record<string, unknown>>).map((o) => ({
      label: String(o.label ?? o.value ?? ""),
      value: String(o.value ?? o.label ?? ""),
      ...(typeof o.description === "string" ? { description: o.description } : {}),
    }));
  }
  if (kind === "text") {
    if (typeof input.placeholder === "string") q.placeholder = input.placeholder;
    if (typeof input.initial === "string") q.initial = input.initial;
  }
  return q;
}

/** Last non-empty agent turn text, read from disk (works on a dormant session). */
async function lastAgentText(session: GarageSession): Promise<string | null> {
  const turns = turnsFromMessages(await session.peekStore().getDisplayMessages());
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]!;
    if (t.kind === "agent" && typeof t.text === "string" && t.text.length > 0) return t.text;
  }
  return null;
}

/** Stat the deliverable files (declared paths under uploads/, else the whole folder). */
function resultFiles(uploadsRoot: string, declared: DeliveredResult | null): TaskFile[] {
  if (declared) {
    const out: TaskFile[] = [];
    for (const rel of declared.files) {
      const abs = path.resolve(uploadsRoot, rel);
      // Defense in depth: never stat outside uploads/ even if the on-disk
      // result was hand-written with `../` or an absolute path.
      if (abs !== uploadsRoot && !abs.startsWith(uploadsRoot + path.sep)) continue;
      try {
        const st = fs.statSync(abs);
        if (st.isFile()) out.push({ path: rel, size: st.size, modified_at: st.mtime.toISOString() });
      } catch { /* declared file vanished — skip */ }
    }
    return out;
  }
  try {
    return fs.statSync(uploadsRoot).isDirectory() ? walk(uploadsRoot, uploadsRoot) : [];
  } catch {
    return [];
  }
}

/** Build the full Task DTO from its record + (optional) live/dormant session. */
export async function buildTaskDto(
  record: TaskRecord,
  session: GarageSession | undefined,
  config: GarageConfig,
  now: number,
): Promise<TaskDto> {
  // Resolve task files from the SESSION's own dataDir (correct for tenant
  // namespaces, whose dataDir differs from the garage config's).
  const paths = session ? resolveSessionPaths(session.dataDir, record.id) : null;
  const declared = paths ? readDeliveredResult(paths.taskResultFile) : null;
  const progress = paths ? readProgressNote(paths.taskProgressFile) : null;
  const text = session ? await lastAgentText(session) : null;
  const uploadsRoot = session ? path.join(session.workspace, config.filesDir ?? "uploads") : "";
  const files = session ? resultFiles(uploadsRoot, declared) : [];

  const dto = session?.toDto();
  const questions = (session?.openSlots() ?? []).filter((s) => !s.isPermissionRequest).map(toQuestion);
  const status = projectStatus({
    provisionError: record.provision_error,
    hasSession: !!session,
    ageMs: now - Date.parse(record.created_at),
    sessionError: session?.error ?? null,
    openQuestionCount: questions.length,
    busy: session?.stats.busy ?? false,
    lastError: session?.stats.lastError ?? null,
    turnCount: session?.stats.turnCount ?? 0,
    hasOutput: !!declared || text !== null,
    startPending: !!record.held && !record.started,
  });

  const result: TaskResult = {
    summary: declared?.summary ?? null,
    text,
    files,
    ...(declared?.data !== undefined ? { data: declared.data } : {}),
  };

  return {
    id: record.id,
    type: record.type,
    status,
    title: dto?.title ?? null,
    result,
    questions,
    progress: progress?.message ?? null,
    error: record.provision_error ?? session?.error ?? session?.stats.lastError ?? null,
    created_at: record.created_at,
    updated_at: session ? new Date(session.lastActivity).toISOString() : record.created_at,
  };
}
