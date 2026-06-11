/**
 * The per-session sync manifest — the local record of what the mirror has
 * already pushed/pulled, so the next push only ships genuinely new/changed
 * files instead of re-uploading the whole `uploads/` folder every turn.
 *
 * Lives next to the session's own data at
 * `<sessionDataDir>/sessions/<sessionId>/uploads-sync.json`. The session's
 * dataDir (not the garage default) is used so a tenant namespace's manifest
 * sits under that namespace's subtree, alongside the files it describes.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** One mirrored file's identity — size+mtime is enough to detect a local edit. */
export interface ManifestFile {
  size: number;
  mtimeMs: number;
}

export interface SyncManifest {
  files: Record<string, ManifestFile>;
  lastSyncAt: string | null;
  error: string | null;
}

/** Where a session's manifest lives, derived from its OWN dataDir. */
export function manifestPath(sessionDataDir: string, sessionId: string): string {
  return path.join(sessionDataDir, "sessions", sessionId, "uploads-sync.json");
}

/** Read the manifest, or a fresh empty one when absent/corrupt. */
export function readManifest(file: string): SyncManifest {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<SyncManifest>;
    return {
      files: raw.files && typeof raw.files === "object" ? raw.files : {},
      lastSyncAt: typeof raw.lastSyncAt === "string" ? raw.lastSyncAt : null,
      error: typeof raw.error === "string" ? raw.error : null,
    };
  } catch {
    return { files: {}, lastSyncAt: null, error: null };
  }
}

/** Atomically persist the manifest (best-effort: never throws into a sync). */
export function writeManifest(file: string, manifest: SyncManifest): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
    fs.renameSync(tmp, file);
  } catch {
    /* a manifest write failure must not break the session — the next sync retries */
  }
}

/** True when a local file differs from what the manifest last recorded. */
export function isChanged(entry: ManifestFile | undefined, size: number, mtimeMs: number): boolean {
  return !entry || entry.size !== size || entry.mtimeMs !== mtimeMs;
}
