import * as fs from "node:fs";
import * as path from "node:path";
import { deriveProjectId } from "./workspace-id.ts";
import { removeSessionStorage } from "./session-paths.ts";
import { randomSessionName } from "./session-name.ts";
import { type ModelUsage, type UsageTotals, storeTotals, coerceModelUsage } from "./usage.ts";

/**
 * Lightweight metadata view of a saved session — read directly from the
 * snapshot JSON without instantiating a full `GlorpStore`. Used by the
 * session picker so we can show a list of 20 sessions without spinning
 * up 20 stores.
 */
export interface SessionInfo {
  id: string;
  title: string | null;
  firstUserMessage: string | null;
  agentMessageCount: number;
  userMessageCount: number;
  totalMessages: number;
  taskCount: number;
  pendingInboxCount: number;
  tokenCount: number;
  tokensIn: number;
  tokensOut: number;
  /** Per-model usage ledger from the snapshot (empty for pre-usage sessions). */
  usage: ModelUsage[];
  /** Rolled-up token + cost total derived from `usage`. */
  usageTotals: UsageTotals;
  turnCount: number;
  lastActivity: Date;
  /** Workspace this session was created in. Undefined for legacy snapshots. */
  workspace: string | null;
  /** Stable project id (git root-commit hash, falling back to a path hash). */
  projectId: string | null;
}

export type SessionScope =
  /** Only sessions whose `projectId` matches the current workspace. Legacy
   *  snapshots without a projectId are hidden in this mode. */
  | { kind: "project"; workspace: string }
  /** Only sessions whose `workspace` path is exactly this one. Tighter than
   *  `project` — useful when a single repo has multiple worktrees and you
   *  only care about the current checkout. */
  | { kind: "workspace"; workspace: string }
  /** Show everything in the data dir, including legacy unscoped snapshots. */
  | { kind: "all" };

/**
 * Scan `<dataDir>/sessions/*.json` and return the metadata for each.
 * Sorted most-recently-modified first. Malformed files are skipped.
 *
 * Pass a `scope` to filter; defaults to `{ kind: "all" }` for backwards
 * compatibility with callers that don't care about workspace scoping.
 */
export async function listSessions(
  dataDir: string,
  scope: SessionScope = { kind: "all" },
): Promise<SessionInfo[]> {
  const sessionsDir = path.join(dataDir, "sessions");
  if (!fs.existsSync(sessionsDir)) return [];
  const entries = await fs.promises.readdir(sessionsDir, { withFileTypes: true });
  const targetProjectId =
    scope.kind === "project" ? deriveProjectId(scope.workspace) : null;
  const targetWorkspace =
    scope.kind === "workspace" ? path.resolve(scope.workspace) : null;

  // Candidates from both layouts: folder layout (sessions/<id>/session.json)
  // and legacy flat files (sessions/<id>.json), excluding reserved sidecars
  // (roster/resources) and conversational-agent stores (contain "__").
  const candidates: Array<{ id: string; file: string }> = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      candidates.push({ id: e.name, file: path.join(sessionsDir, e.name, "session.json") });
    } else if (e.name.endsWith(".json") && !e.name.endsWith(".tmp")) {
      if (e.name.includes("__")) continue;
      if (e.name.endsWith(".roster.json") || e.name.endsWith(".resources.json")) continue;
      candidates.push({ id: e.name.replace(/\.json$/, ""), file: path.join(sessionsDir, e.name) });
    }
  }

  const results: SessionInfo[] = [];
  for (const { id, file: full } of candidates) {
    try {
      const stat = await fs.promises.stat(full);
      const raw = await fs.promises.readFile(full, "utf-8");
      const snap = JSON.parse(raw) as {
        title?: string | null;
        messages?: Array<{ sender?: string; text?: string }>;
        tasks?: unknown[];
        inboxItems?: Array<{ status?: string }>;
        tokensIn?: number;
        tokensOut?: number;
        usage?: Record<string, unknown>;
        turnCount?: number;
        metadata?: { workspace?: string; projectId?: string; kind?: string };
      };
      if (!Array.isArray(snap.messages)) continue; // not a session transcript
      if (snap.metadata?.kind && snap.metadata.kind !== "session") continue; // skip subagent snapshots
      const snapWorkspace = snap.metadata?.workspace ?? null;
      const snapProjectId = snap.metadata?.projectId ?? null;

      if (targetProjectId && snapProjectId !== targetProjectId) continue;
      if (targetWorkspace && snapWorkspace && path.resolve(snapWorkspace) !== targetWorkspace) continue;
      if (targetWorkspace && !snapWorkspace) continue;

      const msgs = snap.messages ?? [];
      const firstUser = msgs.find((m) => m.sender === "user")?.text ?? null;
      const agentCount = msgs.filter((m) => m.sender === "agent").length;
      const userCount = msgs.filter((m) => m.sender === "user").length;
      const usage = Object.values(snap.usage ?? {})
        .map(coerceModelUsage)
        .filter((u): u is ModelUsage => u !== null);
      results.push({
        id,
        title: typeof snap.title === "string" && snap.title.trim() ? snap.title.trim() : null,
        firstUserMessage: firstUser,
        agentMessageCount: agentCount,
        userMessageCount: userCount,
        totalMessages: msgs.length,
        taskCount: snap.tasks?.length ?? 0,
        pendingInboxCount: (snap.inboxItems ?? []).filter((i) => i.status === "pending").length,
        tokenCount: (snap.tokensIn ?? 0) + (snap.tokensOut ?? 0),
        tokensIn: snap.tokensIn ?? 0,
        tokensOut: snap.tokensOut ?? 0,
        usage,
        usageTotals: storeTotals(snap.tokensIn ?? 0, snap.tokensOut ?? 0, usage),
        turnCount: snap.turnCount ?? 0,
        lastActivity: stat.mtime,
        workspace: snapWorkspace,
        projectId: snapProjectId,
      });
    } catch {
      // Skip malformed sessions — recovery isn't this module's job.
    }
  }
  results.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  return results;
}

/** Delete everything stored for a session (folder layout + any legacy files). */
export async function deleteSession(dataDir: string, sessionId: string): Promise<void> {
  removeSessionStorage(dataDir, sessionId);
}

/**
 * Generate a fresh session id. A friendly `<adjective>-<noun>-<suffix>`
 * codename (the id is an opaque key, never sorted on) so sessions read as a
 * fun name rather than a timestamp.
 */
export function newSessionId(): string {
  return randomSessionName();
}

/** Render an mtime as a short human-readable distance ("3m ago", "yesterday"). */
export function relativeTime(d: Date, now: Date = new Date()): string {
  const ms = now.getTime() - d.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toISOString().slice(0, 10);
}
