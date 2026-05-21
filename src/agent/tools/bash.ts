import { z } from "zod";
import { spawn } from "node:child_process";
import type { GloveFoldArgs } from "glove-core";

const MAX_OUTPUT_BYTES_PER_STREAM = 256 * 1024;

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\s+\/(\s|$)/,
  /:\(\)\{.*\}\s*;:/, // fork bomb
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\b>+\s*\/dev\/(sd[a-z]|nvme\d+n\d+|vd[a-z]|xvd[a-z])/,
];

function dangerousReason(cmd: string): string | null {
  for (const p of DANGEROUS_PATTERNS) {
    if (p.test(cmd)) return `Command matches a destructive pattern (${p}). Refusing.`;
  }
  return null;
}

export function bashTool(workspace: string): GloveFoldArgs<{
  command: string;
  description: string;
  timeout_ms?: number;
}> {
  return {
    name: "bash",
    description:
      "Run a shell command in the workspace via bash -c. Returns combined stdout+stderr + exit code. " +
      "Use dedicated tools (read/write/edit/grep/glob) when one applies. " +
      "Always include `description` so the user sees what you're doing.",
    inputSchema: z.object({
      command: z.string().describe("Shell command to run"),
      description: z.string().describe("One-sentence active-voice summary of what this command does"),
      timeout_ms: z
        .number()
        .int()
        .min(1000)
        .max(600_000)
        .optional()
        .describe("Timeout in ms (default 120000)"),
    }),
    async do(input, _display, _glove, signal) {
      const reason = dangerousReason(input.command);
      if (reason) {
        return { status: "error", data: null, message: reason };
      }
      const timeout = input.timeout_ms ?? 120_000;
      const result = await new Promise<{
        exitCode: number;
        stdout: string;
        stderr: string;
        timedOut: boolean;
      }>((resolve) => {
        const start = Date.now();
        const child = spawn("bash", ["-c", input.command], {
          cwd: workspace,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let stdoutTruncated = false;
        let stderrTruncated = false;
        const onChunk = (which: "stdout" | "stderr") => (buf: Buffer) => {
          const truncated = which === "stdout" ? stdoutTruncated : stderrTruncated;
          if (truncated) return;
          const used = which === "stdout" ? stdoutBytes : stderrBytes;
          const remaining = MAX_OUTPUT_BYTES_PER_STREAM - used;
          if (remaining <= 0) {
            if (which === "stdout") stdoutTruncated = true;
            else stderrTruncated = true;
            return;
          }
          const slice = buf.length > remaining ? buf.slice(0, remaining) : buf;
          if (which === "stdout") {
            stdoutBytes += slice.length;
            stdout += slice.toString("utf-8");
            if (buf.length > remaining) stdoutTruncated = true;
          } else {
            stderrBytes += slice.length;
            stderr += slice.toString("utf-8");
            if (buf.length > remaining) stderrTruncated = true;
          }
        };
        child.stdout.on("data", onChunk("stdout"));
        child.stderr.on("data", onChunk("stderr"));
        let killed = false;
        const sigkillTimer: { ref: NodeJS.Timeout | null } = { ref: null };
        const escalate = () => {
          if (killed) return;
          killed = true;
          try {
            child.kill("SIGTERM");
          } catch {}
          sigkillTimer.ref = setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {}
          }, 2000);
        };
        const timer = setTimeout(escalate, timeout);
        const onAbort = () => escalate();
        signal?.addEventListener("abort", onAbort, { once: true });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (sigkillTimer.ref) clearTimeout(sigkillTimer.ref);
          signal?.removeEventListener("abort", onAbort);
          const timedOut = killed && Date.now() - start >= timeout - 50;
          if (stdoutTruncated) stdout += "\n... [stdout truncated at 256KB]";
          if (stderrTruncated) stderr += "\n... [stderr truncated at 256KB]";
          resolve({ exitCode: code ?? -1, stdout, stderr, timedOut });
        });
      });
      const combined = [
        result.stdout && `stdout:\n${result.stdout}`,
        result.stderr && `stderr:\n${result.stderr}`,
        `exit_code: ${result.exitCode}`,
      ]
        .filter(Boolean)
        .join("\n");
      if (result.exitCode === 0) {
        return {
          status: "success",
          data: combined || "(no output)",
          renderData: { command: input.command, description: input.description, exitCode: 0 },
        };
      }
      return {
        status: "error",
        data: combined,
        message: result.timedOut
          ? `Command timed out after ${timeout}ms`
          : `Command exited with code ${result.exitCode}`,
        renderData: {
          command: input.command,
          description: input.description,
          exitCode: result.exitCode,
        },
      };
    },
  };
}
