import { spawn } from "node:child_process";
import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import { relPath, resolveSafePath } from "./fs-shared.ts";

interface GitApplyResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function applyPatchTool(workspace: string): GloveFoldArgs<{ patch: string }> {
  return {
    name: "apply_patch",
    description:
      "Apply a unified diff patch to files in the workspace. Use for multi-hunk or multi-file edits. " +
      "The patch must be in git/unified-diff format; paths must stay inside the workspace.",
    requiresPermission: true,
    inputSchema: z.object({
      patch: z.string().min(1).describe("Unified diff patch, usually produced by git diff"),
    }),
    async do(input, _display, _glove, signal) {
      const touched = extractPatchPaths(input.patch);
      if (touched.length === 0) {
        return {
          status: "error",
          data: null,
          message: "Patch has no recognizable file paths. Use unified diff/git diff format.",
        };
      }
      for (const p of touched) resolveSafePath(workspace, p);

      const check = await gitApply(workspace, input.patch, true, signal);
      if (check.exitCode !== 0) {
        return {
          status: "error",
          data: checkOutput(check),
          message: "Patch check failed; no files were changed.",
        };
      }
      const applied = await gitApply(workspace, input.patch, false, signal);
      if (applied.exitCode !== 0) {
        return {
          status: "error",
          data: checkOutput(applied),
          message: "Patch apply failed after check.",
        };
      }
      const files = touched.map((p) => relPath(workspace, resolveSafePath(workspace, p)));
      return {
        status: "success",
        data: `Applied patch to ${files.join(", ")}`,
        renderData: { files, patch: input.patch },
      };
    },
  };
}

export function extractPatchPaths(patch: string): string[] {
  const paths = new Set<string>();
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      for (const part of line.slice("diff --git ".length).trim().split(/\s+/)) {
        addPath(paths, part);
      }
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      addPath(paths, line.slice(4).trim().split(/\s+/)[0] ?? "");
    }
  }
  return [...paths];
}

function addPath(paths: Set<string>, raw: string): void {
  if (!raw || raw === "/dev/null") return;
  const cleaned = raw.replace(/^"(.*)"$/, "$1").replace(/^[ab]\//, "");
  if (cleaned && cleaned !== "/dev/null") paths.add(cleaned);
}

function gitApply(
  workspace: string,
  patch: string,
  checkOnly: boolean,
  signal?: AbortSignal,
): Promise<GitApplyResult> {
  return new Promise((resolve) => {
    const args = ["apply", "--whitespace=nowarn", ...(checkOnly ? ["--check"] : []), "-"];
    const child = spawn("git", args, { cwd: workspace, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf-8")));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf-8")));
    const onAbort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ exitCode: -1, stdout, stderr: `${stderr}\n${err.message}` });
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
    child.stdin.end(patch);
  });
}

function checkOutput(result: GitApplyResult): string {
  return [
    result.stdout && `stdout:\n${result.stdout}`,
    result.stderr && `stderr:\n${result.stderr}`,
    `exit_code: ${result.exitCode}`,
  ].filter(Boolean).join("\n");
}
