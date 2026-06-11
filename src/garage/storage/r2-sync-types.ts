/**
 * Public types for the uploads sync engine, plus the module-level "active
 * engine" registry. Split out of `r2-sync.ts` to keep that file focused on the
 * engine factory (and both under the 200-line ceiling).
 */

import type { UploadsScope, UploadsSync } from "./types.ts";

/** Tunables for the engine (the debounce is shortened in tests). */
export interface UploadsSyncOptions {
  /** Per-session push debounce window in ms. Defaults to 1500. */
  debounceMs?: number;
}

/**
 * The scope as the engine needs it: the base `UploadsScope` plus the session's
 * OWN dataDir, so the manifest lands under the right (per-namespace) subtree.
 * Structurally extends `UploadsScope` (storage/types.ts is frozen) — every
 * `UploadsSync` method still accepts a plain `UploadsScope`; callers that have
 * the dataDir pass this wider shape and the engine reads it off `scope`.
 */
export interface UploadsScopeWithData extends UploadsScope {
  /** The session's data dir (namespace dataDir) — where its manifest lives. */
  dataDir: string;
}

/**
 * Extends the seam with an explicit remote delete. The REST `DELETE` propagates
 * to the bucket; the agent's `rm` deliberately does NOT (see files.ts), and the
 * push sweep never deletes either — remote-only objects may have been put there
 * by the user's other systems, and the mirror must never destroy what it didn't
 * write.
 */
export interface UploadsSyncEngine extends UploadsSync {
  removeRemote(scope: UploadsScope, rel: string): Promise<void>;
  /** True once a session has been auto-pulled this process (in-memory latch). */
  hasAutoPulled(sessionId: string): boolean;
  markAutoPulled(sessionId: string): void;
}

/**
 * The garage-global engine plus the resolved uploads-dir name. Held at module
 * scope so code paths that can't be handed the engine through a constructor
 * (notably the turn-completion push in `session.ts`, built by the frozen
 * `manager.ts`) can reach it. The dir name rides along so that push targets the
 * same folder the file routes use (honors a custom `config.filesDir`).
 */
export interface ActiveUploadsSync {
  engine: UploadsSyncEngine;
  uploadsDir: string;
}

let active: ActiveUploadsSync | null = null;

export function setActiveUploadsSync(value: ActiveUploadsSync | null): void {
  active = value;
}

export function getActiveUploadsSync(): ActiveUploadsSync | null {
  return active;
}
