/**
 * Persists orchestrator agent records to disk so they survive restarts.
 * On resume, the UI can show what agents existed and their final status.
 * All mutations are serialized through an in-process write queue to
 * prevent concurrent read-modify-write races on the JSON file.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentId, Slot } from "./types.ts";

/** Per-meshDir write queues so concurrent upsert/stop calls don't race. */
const writeQueues = new Map<string, Promise<void>>();
function serialized<T>(meshDir: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeQueues.get(meshDir) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  writeQueues.set(meshDir, next.then(() => {}, () => {}));
  return next;
}

export type AgentStatus = "running" | "completed" | "stopped" | "interrupted";

export interface AgentRecord {
  id: string;
  label: string;
  role: string;
  slot: Slot;
  status: AgentStatus;
  runId: string;
  spawnedAt: number;
  stoppedAt?: number;
  stopReason?: string;
}

function statePath(meshDir: string): string {
  return path.join(meshDir, "agents-state.json");
}

export async function loadAgentRecords(meshDir: string): Promise<AgentRecord[]> {
  try {
    const raw = await fs.readFile(statePath(meshDir), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveAgentRecords(meshDir: string, records: AgentRecord[]): Promise<void> {
  await fs.mkdir(meshDir, { recursive: true });
  const filePath = statePath(meshDir);
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(records, null, 2), "utf-8");
  await fs.rename(tmp, filePath);
}

export function upsertAgentRecord(
  meshDir: string,
  record: AgentRecord,
): Promise<void> {
  return serialized(meshDir, async () => {
    const records = await loadAgentRecords(meshDir);
    const idx = records.findIndex((r) => r.id === record.id);
    if (idx >= 0) records[idx] = record;
    else records.push(record);
    await saveAgentRecords(meshDir, records);
  });
}

export function markAgentStopped(
  meshDir: string,
  id: AgentId,
  reason: string,
): Promise<void> {
  return serialized(meshDir, async () => {
    const records = await loadAgentRecords(meshDir);
    const rec = records.find((r) => r.id === id);
    if (rec) {
      rec.status = "stopped";
      rec.stoppedAt = Date.now();
      rec.stopReason = reason;
      await saveAgentRecords(meshDir, records);
    }
  });
}

/** Mark all running agents as interrupted (called during shutdown). */
export function markAllInterrupted(meshDir: string): Promise<void> {
  return serialized(meshDir, async () => {
    const records = await loadAgentRecords(meshDir);
    let changed = false;
    const now = Date.now();
    for (const rec of records) {
      if (rec.status === "running") {
        rec.status = "interrupted";
        rec.stoppedAt = now;
        rec.stopReason = "process exited";
        changed = true;
      }
    }
    if (changed) await saveAgentRecords(meshDir, records);
  });
}

/** Remove completed/stopped records older than `maxAge` ms (default 24h). */
export function pruneStaleRecords(
  meshDir: string,
  maxAge = 86_400_000,
): Promise<void> {
  return serialized(meshDir, async () => {
    const records = await loadAgentRecords(meshDir);
    const cutoff = Date.now() - maxAge;
    const kept = records.filter((r) =>
      r.status === "running" || r.status === "interrupted" || (r.stoppedAt ?? 0) > cutoff,
    );
    if (kept.length !== records.length) {
      await saveAgentRecords(meshDir, kept);
    }
  });
}
