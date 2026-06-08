/**
 * File-exchange routes for a session's workspace. Each session gets a dedicated
 * `uploads/` subfolder (configurable via `config.filesDir`) that callers can
 * list, upload into, download from, and delete. The agent reads/writes the same
 * folder, so uploads become inputs and deliverables dropped there are
 * downloadable. All access is confined to that folder via `resolveSafePath`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionManager } from "../manager.ts";
import type { GarageConfig } from "../config.ts";
import { resolveSafePath } from "../../agent/tools/fs-shared.ts";
import { json, errorJson, noContent } from "../respond.ts";
import type { FileEntry } from "../contract.ts";

const DEFAULT_DIR = "uploads";

export interface FileRoutes {
  list(id: string): Promise<Response>;
  upload(id: string, req: Request): Promise<Response>;
  download(id: string, rel: string): Promise<Response>;
  remove(id: string, rel: string): Promise<Response>;
}

export function fileRoutes(manager: SessionManager, config: GarageConfig): FileRoutes {
  /** Absolute path to the session's exchange folder, created on first use. */
  function rootFor(id: string): string | null {
    const session = manager.getOrRehydrate(id);
    if (!session) return null;
    const root = path.join(session.workspace, config.filesDir ?? DEFAULT_DIR);
    fs.mkdirSync(root, { recursive: true });
    return root;
  }

  return {
    async list(id): Promise<Response> {
      const root = rootFor(id);
      if (!root) return errorJson("not_found", `Session ${id} not found`, 404);
      return json({ files: walk(root, root) });
    },

    async upload(id, req): Promise<Response> {
      const root = rootFor(id);
      if (!root) return errorJson("not_found", `Session ${id} not found`, 404);
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
      return json({ files: stored }, 201);
    },

    async download(id, rel): Promise<Response> {
      const root = rootFor(id);
      if (!root) return errorJson("not_found", `Session ${id} not found`, 404);
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
      const root = rootFor(id);
      if (!root) return errorJson("not_found", `Session ${id} not found`, 404);
      let abs: string;
      try {
        abs = resolveSafePath(root, rel);
      } catch (err) {
        return errorJson("bad_request", (err as Error).message, 400);
      }
      if (!fs.existsSync(abs)) return errorJson("not_found", `No file: ${rel}`, 404);
      fs.rmSync(abs, { recursive: true, force: true });
      return noContent();
    },
  };
}

/** Recursively list files under `dir`, with paths relative to `root`. */
function walk(dir: string, root: string): FileEntry[] {
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
