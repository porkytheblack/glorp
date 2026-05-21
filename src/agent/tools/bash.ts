import { z } from "zod";
import { spawn } from "node:child_process";
import type { GloveFoldArgs } from "glove-core";

const MAX_OUTPUT_BYTES = 256 * 1024;

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\s+\/(\s|$)/,
  /:\(\)\{.*\}\s*;:/, // fork bomb
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\b>\s*\/dev\/sd[a-z]/,
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
        const child = spawn("bash", ["-c", input.command], {
          cwd: workspace,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let bytes = 0;
        let truncated = false;
        const onChunk = (which: "stdout" | "stderr") => (buf: Buffer) => {
          if (truncated) return;
          const remaining = MAX_OUTPUT_BYTES - bytes;
          if (remaining <= 0) {
            truncated = true;
            return;
          }
          const slice = buf.length > remaining ? buf.slice(0, remaining) : buf;
          bytes += slice.length;
          if (which === "stdout") stdout += slice.toString("utf-8");
          else stderr += slice.toString("utf-8");
          if (buf.length > remaining) truncated = true;
        };
        child.stdout.on("data", onChunk("stdout"));
        child.stderr.on("data", onChunk("stderr"));
        const timer = setTimeout(() => {
          try {
            child.kill("SIGTERM");
          } catch {}
          setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {}
          }, 2000);
        }, timeout);
        const onAbort = () => {
          try {
            child.kill("SIGTERM");
          } catch {}
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        child.on("close", (code) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          const timedOut = Date.now() - start >= timeout - 50 && code !== 0;
          if (truncated) {
            stdout += "\n... [stdout truncated]";
            stderr += "\n... [stderr truncated]";
          }
          resolve({ exitCode: code ?? -1, stdout, stderr, timedOut });
        });
        const start = Date.now();
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
