import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import { SIGNAL_SCHEMAS } from "./signals.ts";
import type {
  FleetJobConfig,
  FleetJobInput,
  FleetJobResult,
  FleetSignalKind,
} from "./types.ts";

interface SpawnOpts {
  kind: FleetSignalKind;
  input: FleetJobInput;
  config: FleetJobConfig;
  signal: AbortSignal;
}

/** Resolve the command + args needed to spin up a worker subprocess. */
function workerCommand(): { cmd: string; args: string[] } {
  const isCompiled = !!process.argv[0] && !process.argv[0].endsWith("bun");
  if (isCompiled) return { cmd: process.argv[0]!, args: ["--worker"] };
  const entry = path.join(import.meta.dir ?? process.cwd(), "..", "..", "cli.ts");
  return { cmd: "bun", args: ["run", entry, "--worker"] };
}

/** Run one fleet job in a fresh bun subprocess; resolve with its reply. */
export async function spawnFleetJob(opts: SpawnOpts): Promise<FleetJobResult> {
  const parsed = SIGNAL_SCHEMAS[opts.kind].inputSchema.safeParse(opts.input);
  if (!parsed.success) {
    return errorResult(`invalid input: ${parsed.error.message}`);
  }
  const startedAt = Date.now();
  const { cmd, args } = workerCommand();
  const child = spawn(cmd, args, {
    cwd: opts.config.workspace,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const abortHandler = () => {
    try { child.kill("SIGTERM"); } catch {}
    setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 1500);
  };
  if (opts.signal.aborted) abortHandler();
  else opts.signal.addEventListener("abort", abortHandler, { once: true });
  try {
    return await driveChild(child, opts, startedAt);
  } finally {
    opts.signal.removeEventListener("abort", abortHandler);
  }
}

async function driveChild(
  child: ChildProcess,
  opts: SpawnOpts,
  startedAt: number,
): Promise<FleetJobResult> {
  const payload = JSON.stringify({
    kind: opts.kind,
    input: opts.input,
    config: opts.config,
  });
  child.stdin?.write(payload);
  child.stdin?.end();
  const stdout = await collectStream(child.stdout);
  const stderr = await collectStream(child.stderr);
  const exitCode = await waitForExit(child);
  const endedAt = Date.now();
  if (opts.signal.aborted) return errorResult("aborted", startedAt, endedAt);
  if (exitCode === null) return errorResult("worker killed before exit", startedAt, endedAt);
  return parseReply(stdout, stderr, exitCode, startedAt, endedAt);
}

function parseReply(
  stdout: string,
  stderr: string,
  exitCode: number,
  startedAt: number,
  endedAt: number,
): FleetJobResult {
  if (stdout) {
    try {
      const parsed = JSON.parse(stdout) as { ok: boolean; response: string };
      return { ok: parsed.ok, response: parsed.response, startedAt, endedAt };
    } catch {
      // fall through to a stderr/exit-code summary
    }
  }
  const detail = stderr ? `\nstderr: ${stderr.slice(0, 2000)}` : "";
  return {
    ok: exitCode === 0,
    response: `worker exited ${exitCode}${detail}`,
    startedAt,
    endedAt,
  };
}

function collectStream(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (!stream) return Promise.resolve("");
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    stream.on("data", (b: Buffer) => chunks.push(b));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", () => resolve(null));
  });
}

function errorResult(reason: string, startedAt = Date.now(), endedAt = Date.now()): FleetJobResult {
  return { ok: false, response: reason, startedAt, endedAt };
}
