/**
 * Per-session error log. Captures every error that occurs during a session so
 * it can be inspected after the fact — bridge `error` events (the things that
 * flash in the UI and vanish) plus a tee of `console.error` (internal failures
 * with stacks, e.g. store flush / mesh / session teardown).
 *
 * Format: JSON Lines at `${dataDir}/sessions/${sessionId}.errors.log`.
 * Writes are queued and best-effort — logging must never throw into callers,
 * and failures fall back to the raw stderr stream (never console.error, to
 * avoid recursing through the tee).
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface ErrorLogEntry {
  ts: string;
  source: string;
  message: string;
  detail?: string;
  agentId?: string;
}

export class SessionErrorLog {
  readonly filePath: string;
  private queue: string[] = [];
  private writing = false;

  /** Construct from the session's resolved errors.log path. */
  constructor(filePath: string) {
    this.filePath = filePath;
  }

  record(entry: Omit<ErrorLogEntry, "ts"> & { ts?: string }): void {
    const full: ErrorLogEntry = { ts: new Date().toISOString(), ...entry } as ErrorLogEntry;
    if (!full.message && !full.detail) return;
    this.queue.push(JSON.stringify(full) + "\n");
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.writing) return;
    this.writing = true;
    try {
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
      while (this.queue.length) {
        const chunk = this.queue.splice(0, this.queue.length).join("");
        await fs.promises.appendFile(this.filePath, chunk, "utf-8");
      }
    } catch (err) {
      try { process.stderr.write(`[error-log] write failed: ${String(err)}\n`); } catch { /* give up */ }
    } finally {
      this.writing = false;
      if (this.queue.length) void this.drain();
    }
  }

  /** Wait for all queued lines to be written (call before shutdown). */
  async flush(): Promise<void> {
    while (this.writing || this.queue.length) {
      await this.drain();
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  /** Read the most recent entries (newest last). For tooling / a future UI. */
  async readRecent(limit = 200): Promise<ErrorLogEntry[]> {
    try {
      const txt = await fs.promises.readFile(this.filePath, "utf-8");
      const lines = txt.split("\n").filter(Boolean).slice(-limit);
      return lines.map((l) => {
        try { return JSON.parse(l) as ErrorLogEntry; }
        catch { return { ts: "", source: "unparsed", message: l }; }
      });
    } catch { return []; }
  }
}

// ── console.error tee ─────────────────────────────────────────────
// Installed once per process; routes to whichever session is currently
// active. Always calls the original console.error first so nothing changes
// about existing logging behavior — we only additionally persist.

let activeLog: SessionErrorLog | null = null;
let teed = false;
const originalConsoleError = console.error.bind(console);

function installConsoleTee(): void {
  if (teed) return;
  teed = true;
  console.error = (...args: unknown[]) => {
    try { originalConsoleError(...args); } catch { /* ignore */ }
    try { activeLog?.record({ source: "console", message: args.map(fmtArg).join(" ") }); }
    catch { /* logging must never throw */ }
  };
}

/** Point the console tee + process handlers at a session's log (or null). */
export function setActiveErrorLog(log: SessionErrorLog | null): void {
  activeLog = log;
  if (log) installConsoleTee();
}

function fmtArg(v: unknown): string {
  if (v instanceof Error) return v.stack ?? `${v.name}: ${v.message}`;
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}
