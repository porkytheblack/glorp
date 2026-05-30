/**
 * On-disk session snapshot helpers used for rehydration. Station reuses the
 * agent's `GlorpStore` snapshot files (`<dataDir>/sessions/<id>.json`) so a
 * session created in a previous Station process can be listed and resumed.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface SnapshotMetaView {
  workspace: string | null;
  title: string | null;
  tokensIn: number;
  tokensOut: number;
  turnCount: number;
  lastActivity: Date;
}

function snapshotPath(dataDir: string, id: string): string {
  return path.join(dataDir, "sessions", `${id}.json`);
}

/** Whether a persisted snapshot exists for this session id. */
export function snapshotExists(dataDir: string, id: string): boolean {
  return fs.existsSync(snapshotPath(dataDir, id));
}

/** Read just the metadata Station needs to rehydrate a session, or null. */
export function readSnapshotMeta(dataDir: string, id: string): SnapshotMetaView | null {
  const full = snapshotPath(dataDir, id);
  try {
    const stat = fs.statSync(full);
    const snap = JSON.parse(fs.readFileSync(full, "utf-8")) as {
      title?: string | null;
      tokensIn?: number;
      tokensOut?: number;
      turnCount?: number;
      metadata?: { workspace?: string };
    };
    return {
      workspace: snap.metadata?.workspace ?? null,
      title: typeof snap.title === "string" && snap.title.trim() ? snap.title.trim() : null,
      tokensIn: snap.tokensIn ?? 0,
      tokensOut: snap.tokensOut ?? 0,
      turnCount: snap.turnCount ?? 0,
      lastActivity: stat.mtime,
    };
  } catch {
    return null;
  }
}
