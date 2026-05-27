/**
 * Verification runner — executes typecheck / test / lint commands in the
 * workspace and returns a structured report.  Consumed by the evaluator
 * in the gen-eval loop to ground its judgement on real tooling output.
 */
import { spawn } from "node:child_process";
import type { WorkspaceContext } from "./workspace-context.ts";

export interface VerificationCommand {
  name: string;
  command: string;
  /** If true, failure at this step stops remaining commands. */
  blocking?: boolean;
}

export interface VerificationResult {
  name: string;
  command: string;
  passed: boolean;
  exitCode: number;
  /** Truncated stdout+stderr for prompt injection (max ~2000 chars). */
  output: string;
  durationMs: number;
}

export interface VerificationReport {
  allPassed: boolean;
  results: VerificationResult[];
  /** Short one-liner: "typecheck ✓, test ✗ (exit 1), lint ✓" */
  summary: string;
  /** Full detail block for evaluator prompt. */
  detailBlock: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 2000;
const SIGKILL_GRACE_MS = 2000;

function truncateOutput(raw: string): string {
  if (raw.length <= MAX_OUTPUT_CHARS) return raw;
  const half = Math.floor(MAX_OUTPUT_CHARS / 2) - 30;
  const head = raw.slice(0, half);
  const tail = raw.slice(-half);
  return `${head}\n\n… [${raw.length - head.length - tail.length} chars truncated] …\n\n${tail}`;
}

function formatSummary(results: VerificationResult[]): string {
  return results
    .map((r) => (r.passed ? `${r.name} ✓` : `${r.name} ✗ (exit ${r.exitCode})`))
    .join(", ");
}

function formatDetailBlock(results: VerificationResult[]): string {
  const sections = results.map((r) => {
    const status = r.passed ? "PASS ✓" : "FAIL ✗";
    const header = `### ${r.name} (\`${r.command}\`) — ${status}`;
    if (r.passed && !r.output.trim()) return `${header}\n(no output)`;
    const lines = [header];
    if (!r.passed) lines.push(`Exit code: ${r.exitCode}`);
    if (r.output.trim()) lines.push("```", r.output.trim(), "```");
    return lines.join("\n");
  });
  return `## Verification Results\n${sections.join("\n\n")}`;
}

/** Spawn a bash child, capture combined output, enforce timeout + signal. */
function execCommand(
  cmd: string, cwd: string, timeoutMs: number, signal?: AbortSignal,
): Promise<{ exitCode: number; output: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", cmd], {
      cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => chunks.push(b));
    child.stderr.on("data", (b: Buffer) => chunks.push(b));

    let killed = false;
    let sigkillRef: ReturnType<typeof setTimeout> | null = null;
    const escalate = () => {
      if (killed) return;
      killed = true;
      try { child.kill("SIGTERM"); } catch { /* already dead */ }
      sigkillRef = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already dead */ }
      }, SIGKILL_GRACE_MS);
    };

    const timer = setTimeout(escalate, timeoutMs);
    const onAbort = () => escalate();
    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (sigkillRef) clearTimeout(sigkillRef);
      signal?.removeEventListener("abort", onAbort);
      const raw = Buffer.concat(chunks).toString("utf-8");
      resolve({ exitCode: code ?? -1, output: truncateOutput(raw), timedOut: killed });
    });
  });
}

function skippedResult(cmd: VerificationCommand, reason: string): VerificationResult {
  return { name: cmd.name, command: cmd.command, passed: false, exitCode: -1, output: reason, durationMs: 0 };
}

/** Run a set of verification commands sequentially in the workspace. */
export async function runVerification(
  workspace: string,
  commands: VerificationCommand[],
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<VerificationReport> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const results: VerificationResult[] = [];

  for (const cmd of commands) {
    if (opts?.signal?.aborted) {
      results.push(skippedResult(cmd, "Cancelled before execution."));
      continue;
    }
    const start = performance.now();
    const { exitCode, output, timedOut } = await execCommand(
      cmd.command, workspace, timeoutMs, opts?.signal,
    );
    const durationMs = Math.round(performance.now() - start);
    const passed = exitCode === 0 && !timedOut;
    const prefix = timedOut ? `Timed out after ${timeoutMs}ms.\n` : "";
    results.push({
      name: cmd.name, command: cmd.command, passed, exitCode,
      output: prefix + output, durationMs,
    });

    if (!passed && cmd.blocking) {
      for (const remaining of commands.slice(results.length)) {
        results.push(skippedResult(remaining, `Skipped: blocking command "${cmd.name}" failed.`));
      }
      break;
    }
  }

  return {
    allPassed: results.every((r) => r.passed),
    results,
    summary: formatSummary(results),
    detailBlock: formatDetailBlock(results),
  };
}

/** Auto-detect verification commands from workspace context. */
export function defaultVerificationCommands(ctx: WorkspaceContext): VerificationCommand[] {
  const cmds: VerificationCommand[] = [];
  if (ctx.typecheckCommand)
    cmds.push({ name: "typecheck", command: ctx.typecheckCommand, blocking: true });
  if (ctx.testCommand)
    cmds.push({ name: "test", command: ctx.testCommand, blocking: false });
  if (ctx.lintCommand)
    cmds.push({ name: "lint", command: ctx.lintCommand, blocking: false });
  return cmds;
}
