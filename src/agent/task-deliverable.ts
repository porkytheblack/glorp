/**
 * Deliverable contracts — the deterministic definition of "done" for a task
 * type. A template declares what artifact its tasks MUST yield; the task sink
 * validates a `deliver_result` call against it and REJECTS the call (so the
 * task can never read "completed") until the real artifact exists, is the right
 * type, and passes an optional verification command. This is the
 * model-independent lever: a weaker model can no longer ship a JSON storyboard
 * as a "video", nor mark a task done with no files at all.
 */

import * as path from "node:path";
import { sniffDeliverableFile } from "./deliverable-sniff.ts";

/**
 * What artifact a task of a given template MUST yield. Absent ⇒ a text-only
 * task (research / Q&A): no gating beyond the universal missing-file check.
 *
 * `verify.command` is best-effort integrity (e.g. `ffprobe`): a non-zero exit
 * rejects the deliverable, but a missing toolchain (exit 127 / spawn failure)
 * is treated as "could not verify here" and does NOT reject — a correct
 * artifact must never be lost on a misconfigured host. Authors of piped verify
 * commands should `set -o pipefail` or test tool presence themselves.
 */
export interface DeliverableContract {
  /** When true, the task is not "completed" until a satisfying deliverable is declared. */
  required?: boolean;
  /** Accepted file extensions, case-insensitive, dot optional (e.g. "mp4" or ".mp4"). */
  extensions?: string[];
  /** Minimum count of accepted deliverable files. Defaults to 1 when `required`. */
  minCount?: number;
  /** Shell check run in uploads/ per accepted file; non-zero ⇒ rejected.
   *  `{file}` interpolates the file's absolute path (omit it to run once). */
  verify?: { command: string; timeoutMs?: number };
  /** Human description, injected into the worker preamble and surfaced to clients. */
  description?: string;
}

/** Task-mode context threaded from the template through to the agent + sink. */
export interface TaskContext {
  type: string;
  deliverable?: DeliverableContract | null;
}

export type DeliverableViolationCode =
  | "missing_files" | "no_files" | "wrong_extension" | "too_few" | "corrupt_file" | "verify_failed";

export interface DeliverableViolation {
  code: DeliverableViolationCode;
  message: string;
}

const DEFAULT_VERIFY_TIMEOUT_MS = 30_000;

/** Normalize an extension to a lowercase, dot-less token ("MP4" / ".mp4" → "mp4"). */
function normExt(ext: string): string {
  return ext.trim().toLowerCase().replace(/^\./, "");
}

/** The extension of an uploads-relative file, lowercase and dot-less. */
function fileExt(rel: string): string {
  return path.extname(rel).toLowerCase().replace(/^\./, "");
}

/** A human phrase for what the contract expects, for prompts + error messages. */
export function describeDeliverable(contract: DeliverableContract): string {
  if (contract.description) return contract.description;
  if (contract.extensions?.length) {
    return `a ${contract.extensions.map(normExt).map((e) => "." + e).join(" / ")} file`;
  }
  return "a deliverable file";
}

export interface ValidateDeliverableArgs {
  contract: DeliverableContract;
  /** Absolute path of the session's uploads/ folder (deliverables live here). */
  uploadsRoot: string;
  /** Accepted, normalized (uploads-relative) deliverable files that exist on disk. */
  files: string[];
  /** Declared paths that did NOT resolve to a real file — named, never silently dropped. */
  missing: string[];
}

/**
 * Validate a declared deliverable against the contract. Returns [] when it is
 * satisfied, else an ordered list of specific, actionable violations the agent
 * can act on. The verify command runs last (only once structure is sound).
 */
export async function validateDeliverable(args: ValidateDeliverableArgs): Promise<DeliverableViolation[]> {
  const { contract, uploadsRoot, files, missing } = args;
  const expected = describeDeliverable(contract);
  const violations: DeliverableViolation[] = [];

  if (missing.length > 0) {
    violations.push({
      code: "missing_files",
      message:
        `these declared deliverable files do not exist: ${missing.join(", ")} — ` +
        "create them (or remove them from `files`) before delivering.",
    });
  }

  const required = contract.required === true;
  if (required && files.length === 0) {
    violations.push({
      code: "no_files",
      message:
        `this task must deliver ${expected} via deliver_result, but no files were declared. ` +
        "Produce the artifact and pass its path in `files`.",
    });
    return violations; // nothing to check against
  }

  const accepted = contract.extensions?.length
    ? files.filter((f) => contract.extensions!.some((e) => normExt(e) === fileExt(f)))
    : files;
  const minCount = contract.minCount ?? (required ? 1 : 0);

  if (contract.extensions?.length && files.length > 0 && accepted.length === 0) {
    violations.push({
      code: "wrong_extension",
      message:
        `this task must deliver ${expected}; the declared file(s) (${files.join(", ")}) are not an ` +
        "accepted type. A JSON storyboard, spec, or plan is NOT the deliverable — render the real " +
        "artifact and deliver that.",
    });
  }

  if (accepted.length < minCount) {
    violations.push({
      code: "too_few",
      message: `this task requires at least ${minCount} ${expected}; got ${accepted.length}.`,
    });
  }

  // Built-in structural check (magic bytes, PDF trailer) on every accepted
  // file — toolchain-free, so unlike `verify` it can never be skipped. This is
  // what stops an unopenable "pdf" or a text file named .mp4 from ever
  // reading "completed".
  if (violations.length === 0) {
    for (const rel of accepted) {
      const verdict = sniffDeliverableFile(uploadsRoot, rel);
      if (!verdict.ok) {
        violations.push({
          code: "corrupt_file",
          message:
            `the deliverable '${rel}' is not a well-formed file: ${verdict.reason}. ` +
            "Rebuild the artifact properly and verify it opens before delivering again.",
        });
      }
    }
  }

  if (violations.length === 0 && contract.verify?.command) {
    const targets = contract.verify.command.includes("{file}") ? accepted : accepted.slice(0, 1);
    const timeoutMs = contract.verify.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
    for (const rel of targets) {
      const res = await execCheck(contract.verify.command, uploadsRoot, path.join(uploadsRoot, rel), timeoutMs);
      if (res.kind === "fail") {
        violations.push({
          code: "verify_failed",
          message: `the deliverable '${rel}' failed verification: ${res.output || "(no output)"}`,
        });
      }
      // res.kind === "skipped" (toolchain missing): keep the structural verdict.
    }
  }

  return violations;
}

type CheckResult = { kind: "ok" } | { kind: "fail"; output: string } | { kind: "skipped" };

/**
 * Run `bash -c command` in `cwd` with `{file}` replaced by the file's absolute
 * path. Non-zero exit ⇒ fail (truncated combined output). A missing toolchain
 * (spawn error / exit 127) ⇒ skipped, not fail.
 */
async function execCheck(command: string, cwd: string, file: string, timeoutMs: number): Promise<CheckResult> {
  const cmd = command.includes("{file}") ? command.split("{file}").join(shellQuote(file)) : command;
  try {
    const proc = Bun.spawn(["bash", "-c", cmd], { cwd, stdout: "pipe", stderr: "pipe", env: process.env });
    const timer = setTimeout(() => { try { proc.kill(); } catch { /* already gone */ } }, timeoutMs);
    const code = await proc.exited;
    clearTimeout(timer);
    const out = ((await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text())).trim().slice(0, 500);
    if (code === 0) return { kind: "ok" };
    if (code === 127) return { kind: "skipped" }; // command not found → can't verify here
    return { kind: "fail", output: out };
  } catch {
    return { kind: "skipped" }; // spawn failed (no bash) → can't verify here
  }
}

/** Minimal single-quote shell escaping for an absolute path. */
function shellQuote(s: string): string {
  return `'${s.split("'").join("'\\''")}'`;
}
