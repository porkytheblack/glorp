/**
 * The uploads sync engine — a MIRROR of each session's local `uploads/` folder
 * to an S3-compatible bucket (Cloudflare R2 etc.). Local is canonical while a
 * session is live; the bucket lets the user's OTHER systems reach the same
 * files under `[prefix/]<namespace>/<session>/…`.
 *
 * Reactivity: config is read from the store at CALL time, so a `PUT /storage`
 * flips behavior live with no restart. Every method is safe when unconfigured.
 *
 * Push is debounced per session so a burst of writes coalesces into one sweep;
 * errors are recorded in status + manifest and logged once per distinct
 * message — never thrown into the agent or HTTP callers.
 */

import * as path from "node:path";
import type { StorageConfigStore } from "./config-store.ts";
import type { UploadsScope, UploadsRemoteStatus } from "./types.ts";
import {
  manifestPath,
  readManifest,
  writeManifest,
  isChanged,
  type SyncManifest,
} from "./sync-manifest.ts";
import { clientFor, keyPrefix, keyFor, walkLocal, listRemote } from "./r2-client.ts";
import type { UploadsScopeWithData, UploadsSyncEngine, UploadsSyncOptions } from "./r2-sync-types.ts";

export type { UploadsScopeWithData, UploadsSyncEngine, UploadsSyncOptions, ActiveUploadsSync } from "./r2-sync-types.ts";
export { setActiveUploadsSync, getActiveUploadsSync } from "./r2-sync-types.ts";

const DEFAULT_DEBOUNCE_MS = 1500;

interface SessionState {
  timer: ReturnType<typeof setTimeout> | null;
  error: string | null;
  lastSyncAt: string | null;
}

export function createUploadsSync(
  store: StorageConfigStore,
  dataDir: string,
  opts: UploadsSyncOptions = {},
): UploadsSyncEngine {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const states = new Map<string, SessionState>();
  const autoPulled = new Set<string>();
  const loggedErrors = new Set<string>();

  const stateFor = (id: string): SessionState =>
    states.get(id) ?? (states.set(id, { timer: null, error: null, lastSyncAt: null }), states.get(id)!);

  /** Manifest path from the scope's own dataDir, falling back to the garage's. */
  const manifestFor = (scope: UploadsScope): string =>
    manifestPath((scope as UploadsScopeWithData).dataDir ?? dataDir, scope.sessionId);

  const logOnce = (message: string): void => {
    if (loggedErrors.has(message)) return;
    loggedErrors.add(message);
    console.warn(`[glorp-garage] uploads-sync: ${message}`);
  };

  const recordError = (scope: UploadsScope, err: unknown): void => {
    const message = err instanceof Error ? err.message : String(err);
    const st = stateFor(scope.sessionId);
    st.error = message;
    const file = manifestFor(scope);
    const manifest = readManifest(file);
    manifest.error = message;
    writeManifest(file, manifest);
    logOnce(message);
  };

  const recordOk = (scope: UploadsScope, manifest: SyncManifest, when: string): void => {
    const st = stateFor(scope.sessionId);
    st.error = null;
    st.lastSyncAt = when;
    manifest.error = null;
    manifest.lastSyncAt = when;
    writeManifest(manifestFor(scope), manifest);
  };

  /** Walk the local root, upload new/changed files, update the manifest. */
  const push = async (scope: UploadsScope): Promise<void> => {
    const config = store.get();
    if (!store.usable()) return;
    const client = clientFor(config);
    const file = manifestFor(scope);
    const manifest = readManifest(file);
    try {
      for (const rel of walkLocal(scope.root)) {
        const abs = path.join(scope.root, rel);
        const st = Bun.file(abs);
        const size = st.size;
        const mtimeMs = (await st.stat()).mtimeMs;
        if (!isChanged(manifest.files[rel], size, mtimeMs)) continue;
        await client.file(keyFor(config, scope.nsId, scope.sessionId, rel)).write(st);
        manifest.files[rel] = { size, mtimeMs };
      }
      recordOk(scope, manifest, new Date().toISOString());
    } catch (err) {
      recordError(scope, err);
    }
  };

  const flush = (scope: UploadsScope): void => {
    const st = stateFor(scope.sessionId);
    st.timer = null;
    void push(scope);
  };

  return {
    enabled(): boolean {
      return store.usable();
    },

    scheduleSync(scope: UploadsScope): void {
      if (!store.usable()) return;
      const st = stateFor(scope.sessionId);
      if (st.timer) clearTimeout(st.timer);
      st.timer = setTimeout(() => flush(scope), debounceMs);
    },

    async pullMissing(scope: UploadsScope): Promise<void> {
      const config = store.get();
      if (!store.usable()) return;
      const client = clientFor(config);
      const file = manifestFor(scope);
      const manifest = readManifest(file);
      try {
        const prefix = keyPrefix(config, scope.nsId, scope.sessionId);
        for (const obj of await listRemote(client, prefix)) {
          const rel = obj.key.slice(prefix.length);
          if (!rel) continue; // the folder marker itself, if any
          const abs = path.join(scope.root, rel);
          // Local wins while the session is live: never overwrite a real file.
          if (await Bun.file(abs).exists()) continue;
          const bytes = await client.file(obj.key).arrayBuffer();
          await Bun.write(abs, bytes);
          const mtimeMs = (await Bun.file(abs).stat()).mtimeMs;
          // Record it so the next push doesn't re-upload an unchanged pull.
          manifest.files[rel] = { size: bytes.byteLength, mtimeMs };
        }
        recordOk(scope, manifest, manifest.lastSyncAt ?? new Date().toISOString());
      } catch (err) {
        recordError(scope, err);
      }
    },

    status(sessionId: string): UploadsRemoteStatus {
      const enabled = store.usable();
      const live = states.get(sessionId);
      const manifest = readManifest(manifestPath(dataDir, sessionId));
      return {
        enabled,
        last_sync_at: live?.lastSyncAt ?? manifest.lastSyncAt,
        error: live?.error ?? manifest.error,
      };
    },

    async removeRemote(scope: UploadsScope, rel: string): Promise<void> {
      const config = store.get();
      if (!store.usable()) return;
      const file = manifestFor(scope);
      const manifest = readManifest(file);
      try {
        await clientFor(config).file(keyFor(config, scope.nsId, scope.sessionId, rel)).delete();
        delete manifest.files[rel];
        writeManifest(file, manifest);
      } catch (err) {
        recordError(scope, err);
      }
    },

    hasAutoPulled(sessionId: string): boolean {
      return autoPulled.has(sessionId);
    },

    markAutoPulled(sessionId: string): void {
      autoPulled.add(sessionId);
    },
  };
}
