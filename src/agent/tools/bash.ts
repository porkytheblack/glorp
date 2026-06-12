import { z } from "zod";
import { spawn } from "node:child_process";
import type { DisplayManagerAdapter } from "glove-core/display-manager";
import type { SummaryTool } from "./summaries.ts";
import { compactText, lineCount } from "./summaries.ts";
import { looksLikeMutation } from "../permission-key.ts";
import { guardCommand } from "./command-guard.ts";
import { makeStreamCapture } from "./bash-capture.ts";

interface BashSummaryArgs {
  command: string;
  description: string;
  exitCode: number;
  timedOut: boolean;
  stdoutLines: number;
  stderrLines: number;
  stdoutPreview: string;
  stderrPreview: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

async function askDestructiveConfirm(
  display: DisplayManagerAdapter | undefined,
  command: string,
  reason: string,
): Promise<boolean> {
  if (!display?.pushAndWait) return false;
  const message =
    `Glorp wants to run a destructive shell command (${reason}):\n\n` +
    `  ${command}\n\nAllow this one time? (not remembered)`;
  try {
    const r = await display.pushAndWait<unknown, unknown>({
      renderer: "confirm",
      input: { message, yesLabel: "run once", noLabel: "abort", danger: true },
    });
    return Boolean(r);
  } catch {
    return false;
  }
}

function summaryArgs(input: { command: string; description: string }, result: {
  exitCode: number; timedOut: boolean; stdout: string; stderr: string;
}): BashSummaryArgs {
  return {
    command: input.command,
    description: input.description,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stdoutLines: lineCount(result.stdout),
    stderrLines: lineCount(result.stderr),
    stdoutPreview: compactText(result.stdout, 12, 2000),
    stderrPreview: compactText(result.stderr, 8, 1200),
    stdoutTruncated: result.stdout.includes("[stdout truncated"),
    stderrTruncated: result.stderr.includes("[stderr truncated"),
  };
}

export function bashTool(workspace: string, extraEnv?: Record<string, string>): SummaryTool<{
  command: string; description: string; timeout_ms?: number;
}, BashSummaryArgs> {
  return {
    name: "bash",
    description:
      "Run a shell command in the workspace via bash -c. Returns combined stdout+stderr + exit code. " +
      "Use dedicated tools (read/write/edit/grep/glob) when one applies. " +
      "Always include `description` so the user sees what you're doing.",
    requiresPermission: (input) => looksLikeMutation(input.command),
    inputSchema: z.object({
      command: z.string().describe("Shell command to run"),
      description: z.string().describe("One-sentence active-voice summary of what this command does"),
      timeout_ms: z.number().int().min(1000).max(600_000).optional()
        .describe("Timeout in ms (default 120000)"),
    }),
    async do(input, display, _glove, signal) {
      const guard = guardCommand(input.command, workspace);
      if (guard?.severity === "block") {
        return { status: "error", data: null, message: guard.reason };
      }
      if (guard?.severity === "confirm") {
        const ok = await askDestructiveConfirm(display, input.command, guard.reason);
        if (!ok) return { status: "error", data: null, message: `User declined (${guard.reason}).` };
      }
      const result = await runBash(input.command, workspace, input.timeout_ms ?? 120_000, signal, extraEnv);
      const combined = [
        result.stdout && `stdout:\n${result.stdout}`,
        result.stderr && `stderr:\n${result.stderr}`,
        `exit_code: ${result.exitCode}`,
      ].filter(Boolean).join("\n");
      const render = { command: input.command, description: input.description, exitCode: result.exitCode };
      if (result.exitCode === 0) {
        return {
          status: "success", data: combined || "(no output)",
          generateSummaryArgs: summaryArgs(input, result),
          renderData: render,
        };
      }
      return {
        status: "error", data: combined,
        message: result.timedOut ? `Command timed out after ${input.timeout_ms ?? 120_000}ms` : `Command exited with code ${result.exitCode}`,
        generateSummaryArgs: summaryArgs(input, result),
        renderData: render,
      };
    },
    generateToolSummary: async (args) => {
      const a = args as BashSummaryArgs;
      return [
        `Ran: ${a.description}`, `Command: ${a.command}`,
        `Exit code: ${a.exitCode}${a.timedOut ? " (timed out)" : ""}`,
        `stdout: ${a.stdoutLines} line${a.stdoutLines === 1 ? "" : "s"}${a.stdoutTruncated ? " (truncated)" : ""}`,
        a.stdoutPreview ? `stdout preview:\n${a.stdoutPreview}` : "",
        `stderr: ${a.stderrLines} line${a.stderrLines === 1 ? "" : "s"}${a.stderrTruncated ? " (truncated)" : ""}`,
        a.stderrPreview ? `stderr preview:\n${a.stderrPreview}` : "",
        "Full prior command output omitted.",
      ].filter(Boolean).join("\n");
    },
  };
}

function runBash(cmd: string, cwd: string, timeout: number, signal?: AbortSignal, extraEnv?: Record<string, string>) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
    const start = Date.now();
    // extraEnv carries per-session identity (GLORP_SESSION_ID…) — sessions
    // share this process, so per-session values must ride per-spawn env.
    const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;
    const child = spawn("bash", ["-c", cmd], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const out = makeStreamCapture("stdout");
    const err = makeStreamCapture("stderr");
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => err.push(b));
    let killed = false;
    let sigkillRef: NodeJS.Timeout | null = null;
    const escalate = () => {
      if (killed) return;
      killed = true;
      try { child.kill("SIGTERM"); } catch {}
      sigkillRef = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2000);
    };
    const timer = setTimeout(escalate, timeout);
    const onAbort = () => escalate();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (sigkillRef) clearTimeout(sigkillRef);
      signal?.removeEventListener("abort", onAbort);
      resolve({ exitCode: code ?? -1, stdout: out.value(), stderr: err.value(), timedOut: killed && Date.now() - start >= timeout - 50 });
    });
  });
}
