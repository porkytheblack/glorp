/**
 * Task sink — the durable channel between a task-mode agent and the Task API.
 *
 * The agent declares its finished work with `deliver_result` and posts
 * non-blocking notes with `report_progress`; both land as small JSON files in
 * the session folder (see session-paths.ts), so they survive idle-GC and
 * rehydrate and are read back by the Garage Task routes — no IPC, because the
 * main agent runs in-process in the Garage server.
 *
 * Deliverable files are normalized into the session's `uploads/` exchange
 * folder (copying any that the agent left elsewhere), so every declared file is
 * downloadable through the existing files route and mirrored to R2.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** On-disk shape of a declared deliverable (`task-result.json`). */
export interface DeliveredResult {
  summary: string;
  /** Deliverable paths, relative to the session's uploads/ folder. */
  files: string[];
  data?: unknown;
  delivered_at: string;
}

/** On-disk shape of the latest progress note (`task-progress.json`). */
export interface ProgressNote {
  message: string;
  at: string;
}

export interface TaskSink {
  /** Record the finished deliverable; returns the normalized uploads-relative files. */
  deliver(input: { summary: string; files?: string[]; data?: unknown }): { files: string[] };
  /** Post a non-blocking status note (latest wins). */
  progress(message: string): void;
}

export interface TaskSinkOptions {
  resultFile: string;
  progressFile: string;
  workspace: string;
  /** Name of the file-exchange folder under the workspace (default "uploads"). */
  uploadsDir?: string;
  now?: () => string;
}

function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

/** True when `abs` is `root` or strictly under it. */
function within(root: string, abs: string): boolean {
  return abs === root || abs.startsWith(root + path.sep);
}

/**
 * Resolve `rel` to a real file inside `root`; null if it escapes or doesn't
 * exist. Resolves symlinks (realpathSync) so a symlink left under the workspace
 * pointing outside it can't smuggle an external file into a deliverable.
 */
function safeExisting(root: string, realRoot: string, rel: string): string | null {
  const abs = path.resolve(root, rel);
  if (!within(root, abs)) return null;
  try {
    const real = fs.realpathSync(abs);
    if (!within(realRoot, real)) return null;
    return fs.statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

export function createTaskSink(opts: TaskSinkOptions): TaskSink {
  const now = opts.now ?? (() => new Date().toISOString());
  const uploadsDir = opts.uploadsDir ?? "uploads";
  // Resolve symlinks on the workspace root once, so containment checks compare
  // real paths (the workspace itself may be reached via a symlink).
  let realWorkspace = path.resolve(opts.workspace);
  try {
    realWorkspace = fs.realpathSync(realWorkspace);
  } catch {
    /* not yet created — resolve() is a safe fallback */
  }
  const uploadsRoot = path.resolve(realWorkspace, uploadsDir);

  /** Ensure a declared file lives under uploads/ and return its uploads-relative path. */
  function intoUploads(rel: string): string | null {
    const abs = safeExisting(realWorkspace, realWorkspace, rel);
    if (!abs) return null;
    if (within(uploadsRoot, abs)) {
      return path.relative(uploadsRoot, abs).split(path.sep).join("/");
    }
    // The agent left it elsewhere (e.g. ./output) — copy it in so it's
    // downloadable + mirrored. Collisions get a numeric suffix.
    const base = path.basename(abs);
    let dest = path.join(uploadsRoot, base);
    let n = 1;
    while (fs.existsSync(dest) && n < 1000) {
      const ext = path.extname(base);
      dest = path.join(uploadsRoot, `${base.slice(0, base.length - ext.length)}-${n}${ext}`);
      n++;
    }
    fs.mkdirSync(uploadsRoot, { recursive: true });
    fs.copyFileSync(abs, dest);
    return path.relative(uploadsRoot, dest).split(path.sep).join("/");
  }

  return {
    deliver(input) {
      const files = (input.files ?? [])
        .map((f) => intoUploads(f))
        .filter((f): f is string => f !== null);
      const result: DeliveredResult = {
        summary: input.summary,
        files,
        ...(input.data !== undefined ? { data: input.data } : {}),
        delivered_at: now(),
      };
      writeJsonAtomic(opts.resultFile, result);
      return { files };
    },
    progress(message) {
      writeJsonAtomic(opts.progressFile, { message, at: now() } satisfies ProgressNote);
    },
  };
}

/** Read a declared deliverable, or null if none/invalid. */
export function readDeliveredResult(file: string): DeliveredResult | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf-8")) as DeliveredResult;
    return typeof v?.summary === "string" && Array.isArray(v.files) ? v : null;
  } catch {
    return null;
  }
}

/** Read the latest progress note, or null if none/invalid. */
export function readProgressNote(file: string): ProgressNote | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf-8")) as ProgressNote;
    return typeof v?.message === "string" ? v : null;
  } catch {
    return null;
  }
}
