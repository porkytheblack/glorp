import { z } from "zod";
import { spawn } from "node:child_process";
import type { GloveFoldArgs } from "glove-core/glove";
import { compactText, lineCount } from "./summaries.ts";
import { dangerousReason, makeStreamCapture, type StreamCapture } from "./bash-capture.ts";

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

interface BashRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runBash(
  command: string,
  workspace: string,
  timeout: number,
  signal?: AbortSignal,
): Promise<BashRunResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn("bash", ["-c", command], {
      cwd: workspace,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: StreamCapture = makeStreamCapture("stdout");
    const stderr: StreamCapture = makeStreamCapture("stderr");
    child.stdout.on("data", (buf: Buffer) => stdout.push(buf));
    child.stderr.on("data", (buf: Buffer) => stderr.push(buf));
    let killed = false;
    let sigkillTimer: NodeJS.Timeout | null = null;
    const escalate = () => {
      if (killed) return;
      killed = true;
      try { child.kill("SIGTERM"); } catch {}
      sigkillTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2000);
    };
    const timer = setTimeout(escalate, timeout);
    const onAbort = () => escalate();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      signal?.removeEventListener("abort", onAbort);
      const timedOut = killed && Date.now() - start >= timeout - 50;
      resolve({ exitCode: code ?? -1, stdout: stdout.value(), stderr: stderr.value(), timedOut });
    });
  });
}

function summaryArgs(input: { command: string; description: string }, r: BashRunResult): BashSummaryArgs {
  return {
    command: input.command,
    description: input.description,
    exitCode: r.exitCode,
    timedOut: r.timedOut,
    stdoutLines: lineCount(r.stdout),
    stderrLines: lineCount(r.stderr),
    stdoutPreview: compactText(r.stdout, 12, 2000),
    stderrPreview: compactText(r.stderr, 8, 1200),
    stdoutTruncated: r.stdout.includes("[stdout truncated"),
    stderrTruncated: r.stderr.includes("[stderr truncated"),
  };
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
    requiresPermission: true,
    inputSchema: z.object({
      command: z.string().describe("Shell command to run"),
      description: z.string().describe("One-sentence active-voice summary of what this command does"),
      timeout_ms: z.number().int().min(1000).max(600_000).optional()
        .describe("Timeout in ms (default 120000)"),
    }),
    async do(input, _display, _glove, signal) {
      const reason = dangerousReason(input.command);
      if (reason) return { status: "error", data: null, message: reason };
      const timeout = input.timeout_ms ?? 120_000;
      const result = await runBash(input.command, workspace, timeout, signal);
      const combined = [
        result.stdout && `stdout:\n${result.stdout}`,
        result.stderr && `stderr:\n${result.stderr}`,
        `exit_code: ${result.exitCode}`,
      ].filter(Boolean).join("\n");
      const sumArgs = summaryArgs(input, result);
      const render = { command: input.command, description: input.description, exitCode: result.exitCode };
      if (result.exitCode === 0) {
        return { status: "success", data: combined || "(no output)", generateSummaryArgs: sumArgs, renderData: render };
      }
      return {
        status: "error",
        data: combined,
        message: result.timedOut ? `Command timed out after ${timeout}ms` : `Command exited with code ${result.exitCode}`,
        generateSummaryArgs: sumArgs,
        renderData: render,
      };
    },
    generateToolSummary: async (args) => {
      const a = args as BashSummaryArgs;
      return [
        `Ran: ${a.description}`,
        `Command: ${a.command}`,
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
