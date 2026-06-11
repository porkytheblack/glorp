/**
 * Remote uploads storage (Cloudflare R2 / any S3-compatible bucket). The
 * design is a MIRROR, not a remote filesystem: the agent's tools need real
 * files on disk, so the local `uploads/` folder stays canonical for a live
 * session and Garage syncs it to the bucket so other systems can reach the
 * same files. Garage-global by decision — one bucket, sessions keyed under
 * `<prefix>/<namespace>/<session>/…` so tenant data can never collide.
 */

export interface StorageConfig {
  enabled: boolean;
  /** S3 endpoint, e.g. `https://<account>.r2.cloudflarestorage.com`. */
  endpoint?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Optional key prefix inside the bucket (no leading/trailing slash). */
  prefix?: string;
}

/** Per-session remote sync state surfaced in file-listing responses. */
export interface UploadsRemoteStatus {
  enabled: boolean;
  last_sync_at: string | null;
  error: string | null;
}

/** The scope a sync operation acts on — enough to build the bucket key. */
export interface UploadsScope {
  nsId: string;
  sessionId: string;
  /** Absolute path of the session's local uploads folder. */
  root: string;
}

/**
 * The sync engine seam. Wired as a garage-global singleton; every method is
 * safe to call when remote storage is unconfigured (no-ops).
 */
export interface UploadsSync {
  enabled(): boolean;
  /** Push local changes to the bucket — fire-and-forget, errors recorded in status. */
  scheduleSync(scope: UploadsScope): void;
  /** Download bucket objects that are missing locally (session rehydrate / refresh). */
  pullMissing(scope: UploadsScope): Promise<void>;
  status(sessionId: string): UploadsRemoteStatus;
}
