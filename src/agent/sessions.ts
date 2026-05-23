import * as fs from "node:fs";
import * as path from "node:path";

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
  turnCount: number;
  lastActivity: Date;
}

/**
 * Scan `<dataDir>/sessions/*.json` and return the metadata for each.
 * Sorted most-recently-modified first. Malformed files are skipped.
 */
export async function listSessions(dataDir: string): Promise<SessionInfo[]> {
  const sessionsDir = path.join(dataDir, "sessions");
  if (!fs.existsSync(sessionsDir)) return [];
  const files = await fs.promises.readdir(sessionsDir);
  const results: SessionInfo[] = [];
  for (const file of files) {
    if (!file.endsWith(".json") || file.endsWith(".tmp")) continue;
    const full = path.join(sessionsDir, file);
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
        turnCount?: number;
      };
      const msgs = snap.messages ?? [];
      const firstUser = msgs.find((m) => m.sender === "user")?.text ?? null;
      const agentCount = msgs.filter((m) => m.sender === "agent").length;
      const userCount = msgs.filter((m) => m.sender === "user").length;
      results.push({
        id: file.replace(/\.json$/, ""),
        title: typeof snap.title === "string" && snap.title.trim() ? snap.title.trim() : null,
        firstUserMessage: firstUser,
        agentMessageCount: agentCount,
        userMessageCount: userCount,
        totalMessages: msgs.length,
        taskCount: snap.tasks?.length ?? 0,
        pendingInboxCount: (snap.inboxItems ?? []).filter((i) => i.status === "pending").length,
        tokenCount: (snap.tokensIn ?? 0) + (snap.tokensOut ?? 0),
        turnCount: snap.turnCount ?? 0,
        lastActivity: stat.mtime,
      });
    } catch {
      // Skip malformed sessions — recovery isn't this module's job.
    }
  }
  results.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  return results;
}

/** Delete a session's snapshot file. No-op if it doesn't exist. */
export async function deleteSession(dataDir: string, sessionId: string): Promise<void> {
  const p = path.join(dataDir, "sessions", `${sessionId}.json`);
  try {
    await fs.promises.unlink(p);
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
}

/** Generate a stable id for a fresh session. */
export function newSessionId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
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
