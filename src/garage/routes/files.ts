/**
 * File-exchange routes for a session's workspace. Each session gets a dedicated
 * `uploads/` subfolder (configurable via `config.filesDir`) that callers can
 * list, upload into, download from, and delete. The agent reads/writes the same
 * folder, so uploads become inputs and deliverables dropped there are
 * downloadable. All access is confined to that folder via `resolveSafePath`.
 *
 * When a remote uploads mirror (R2) is configured these routes also drive the
 * sync: list rehydrates missing remote files (once per process, or on
 * `?pull=1`) and surfaces sync status; upload pushes; delete also removes the
 * bucket object. Download stays purely local — the mirror is a side channel.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionManager } from "../manager.ts";
import type { GarageConfig } from "../config.ts";
import type { GarageSession } from "../session.ts";
import { resolveSafePath } from "../../agent/tools/fs-shared.ts";
import { json, errorJson, noContent } from "../respond.ts";
import type { FileEntry, FilesRemoteStatus } from "../contract.ts";
import type { UploadsSync } from "../storage/types.ts";
import type { UploadsScopeWithData, UploadsSyncEngine } from "../storage/r2-sync.ts";

const DEFAULT_DIR = "uploads";

export interface FileRoutes {
  /** `req` carries `?pull=1`; optional so non-HTTP callers can list plainly. */
  list(id: string, req?: Request): Promise<Response>;
  upload(id: string, req: Request): Promise<Response>;
  download(id: string, rel: string): Promise<Response>;
  remove(id: string, rel: string): Promise<Response>;
}

/** Narrow the seam to the engine that supports explicit remote deletes. */
function asEngine(sync: UploadsSync | undefined): UploadsSyncEngine | null {
  return sync && "removeRemote" in sync ? (sync as UploadsSyncEngine) : null;
}

export function fileRoutes(
  manager: SessionManager,
  config: GarageConfig,
  nsId = "default",
  uploadsSync?: UploadsSync,
  /** Exchange sub-folder under the workspace. Defaults to the configured
   *  uploads dir; the task surface mounts a second group on "inputs". */
  dirName?: string,
): FileRoutes {
  const engine = asEngine(uploadsSync);
  const folder = dirName ?? config.filesDir ?? DEFAULT_DIR;

  /** Absolute path to the session's exchange folder, created on first use. */
  function rootFor(session: GarageSession): string {
    const root = path.join(session.workspace, folder);
    fs.mkdirSync(root, { recursive: true });
    return root;
  }

  /** The sync scope for a session, carrying its own dataDir for the manifest. */
  function scopeFor(session: GarageSession, root: string): UploadsScopeWithData {
    return { nsId: session.nsId ?? nsId, sessionId: session.id, root, dataDir: session.dataDir };
  }

  return {
    async list(id, req): Promise<Response> {
      const session = manager.getOrRehydrate(id);
      if (!session) return errorJson("not_found", `Session ${id} not found`, 404);
      const root = rootFor(session);
      let remote: FilesRemoteStatus | undefined;
      if (uploadsSync?.enabled()) {
        const scope = scopeFor(session, root);
        const wantPull = req ? new URL(req.url).searchParams.get("pull") === "1" : false;
        const firstTouch = engine ? !engine.hasAutoPulled(id) : false;
        if (wantPull || firstTouch) {
          engine?.markAutoPulled(id);
          await uploadsSync.pullMissing(scope);
        }
        remote = uploadsSync.status(id);
      }
      return json({ files: walk(root, root), ...(remote ? { remote } : {}) });
    },

    async upload(id, req): Promise<Response> {
      const session = manager.getOrRehydrate(id);
      if (!session) return errorJson("not_found", `Session ${id} not found`, 404);
      const root = rootFor(session);
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        return errorJson("bad_request", "Expected multipart/form-data body", 400);
      }
      const parts: File[] = [];
      form.forEach((value) => {
        if (typeof value !== "string") parts.push(value);
      });
      const stored: FileEntry[] = [];
      try {
        for (const file of parts) {
          const abs = resolveSafePath(root, file.name || "upload.bin");
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          await Bun.write(abs, file);
          stored.push(entry(root, abs));
        }
      } catch (err) {
        return errorJson("bad_request", (err as Error).message, 400);
      }
      if (stored.length === 0) return errorJson("bad_request", "No files in request", 400);
      // Fire-and-forget push: the upload response never waits on the bucket.
      uploadsSync?.scheduleSync(scopeFor(session, root));
      return json({ files: stored }, 201);
    },

    async download(id, rel): Promise<Response> {
      const session = manager.getOrRehydrate(id);
      if (!session) return errorJson("not_found", `Session ${id} not found`, 404);
      const root = rootFor(session);
      let abs: string;
      try {
        abs = resolveSafePath(root, rel);
      } catch (err) {
        return errorJson("bad_request", (err as Error).message, 400);
      }
      const file = Bun.file(abs);
      if (!(await file.exists())) return errorJson("not_found", `No file: ${rel}`, 404);
      const name = path.basename(abs);
      return new Response(file, {
        headers: {
          "content-type": file.type || "application/octet-stream",
          "content-disposition": `attachment; filename="${name.replace(/"/g, "")}"`,
        },
      });
    },

    async remove(id, rel): Promise<Response> {
      const session = manager.getOrRehydrate(id);
      if (!session) return errorJson("not_found", `Session ${id} not found`, 404);
      const root = rootFor(session);
      let abs: string;
      try {
        abs = resolveSafePath(root, rel);
      } catch (err) {
        return errorJson("bad_request", (err as Error).message, 400);
      }
      if (!fs.existsSync(abs)) return errorJson("not_found", `No file: ${rel}`, 404);
      fs.rmSync(abs, { recursive: true, force: true });
      // An explicit REST delete DOES propagate to the bucket (best-effort) —
      // unlike the agent's `rm`, which never deletes remote (see r2-sync.ts).
      if (engine) await engine.removeRemote(scopeFor(session, root), rel).catch(() => {});
      return noContent();
    },
  };
}

/** Recursively list files under `dir`, with paths relative to `root`. */
export function walk(dir: string, root: string): FileEntry[] {
  const out: FileEntry[] = [];
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) out.push(...walk(abs, root));
    else out.push(entry(root, abs, st));
  }
  return out;
}

function entry(root: string, abs: string, st = fs.statSync(abs)): FileEntry {
  return {
    path: path.relative(root, abs).split(path.sep).join("/"),
    size: st.size,
    modified_at: st.mtime.toISOString(),
  };
}
