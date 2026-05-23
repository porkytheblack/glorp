import { spawn } from "node:child_process";

export async function runShell(
  cmd: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", cmd], { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let sigkillTimer: NodeJS.Timeout | null = null;

    const killChild = () => {
      try {
        child.kill("SIGTERM");
      } catch {}
      sigkillTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
      }, 1500);
    };

    const onSignal = () => killChild();
    process.once("SIGTERM", onSignal);
    process.once("SIGINT", onSignal);

    child.stdout?.on("data", (b: Buffer) => (stdout += b.toString("utf-8")));
    child.stderr?.on("data", (b: Buffer) => (stderr += b.toString("utf-8")));

    const timer = setTimeout(killChild, timeoutMs);
    const done = (exitCode: number, extraStderr = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      process.removeListener("SIGTERM", onSignal);
      process.removeListener("SIGINT", onSignal);
      resolve({ exitCode, stdout, stderr: stderr + extraStderr });
    };

    child.on("close", (code) => done(code ?? -1));
    child.on("error", () => done(-1, "\n[spawn failed]"));
  });
}

export function shellSummary(result: {
  exitCode: number;
  stdout: string;
  stderr: string;
}): string {
  return (
    `exit=${result.exitCode}\n` +
    (result.stdout ? `stdout:\n${result.stdout.slice(0, 4000)}\n` : "") +
    (result.stderr ? `stderr:\n${result.stderr.slice(0, 2000)}` : "")
  );
}
