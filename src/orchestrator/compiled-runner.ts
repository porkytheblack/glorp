/**
 * Self-spawn runner for the COMPILED glorp binary.
 *
 * The continuum runner spawns `node <bootstrap> <agent-file>`, resolving both
 * scripts via import.meta.url — which inside a compiled binary is a virtual
 * /$bunfs path no child process can read ("Cannot find module
 * '/$bunfs/root/bootstrap.js'"). Here the parent spawns ITSELF
 * (`process.execPath __agent-run <role>`) and the hidden subcommand builds the
 * same agent inline from code compiled into the binary.
 *
 * Triggered orchestrator agents return void — results flow through the mesh
 * and the store — so the run contract is just lifecycle: spawn, wait, exit
 * code, stderr. Lifecycle is reported through the SAME ContinuumSubscriber
 * the dev-mode runner uses, so orchestrator events stay identical.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { ContinuumSubscriber } from "glove-continuum-signal";
import type { RunnerHandle } from "./runner.ts";

interface LiveRun {
  child: ChildProcess;
  done: Promise<RunLike>;
  timer: ReturnType<typeof setTimeout>;
}

/** The Run fields our subscriber callbacks actually read. */
interface RunLike {
  id: string;
  agentName: string;
  status: "completed" | "failed" | "timeout" | "cancelled";
}

export function createCompiledRunner(
  timeoutMs: number,
  subscriber: ContinuumSubscriber,
): RunnerHandle {
  const runs = new Map<string, LiveRun>();
  let seq = 0;

  const emitLog = (agentName: string, level: "stdout" | "stderr", message: string) => {
    subscriber.onLogOutput?.({ agentName, level, message } as never);
  };

  return {
    async trigger(agentName, input) {
      const runId = `crun_${Date.now().toString(36)}_${(seq++).toString(36)}`;
      const child = spawn(process.execPath, ["__agent-run", agentName], {
        env: {
          ...process.env,
          GLORP_AGENT_INPUT: JSON.stringify(input ?? {}),
          GLORP_AGENT_RUN_ID: runId,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.on("data", (d: Buffer) => emitLog(agentName, "stdout", d.toString()));
      child.stderr?.on("data", (d: Buffer) => emitLog(agentName, "stderr", d.toString()));

      let settle!: (r: RunLike) => void;
      const done = new Promise<RunLike>((r) => (settle = r));
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 3_000).unref?.();
      }, timeoutMs);

      child.on("exit", (code, signal) => {
        clearTimeout(timer);
        runs.delete(runId);
        const run: RunLike = {
          id: runId,
          agentName,
          status: timedOut ? "timeout" : code === 0 ? "completed" : "failed",
        };
        if (run.status === "timeout") subscriber.onRunTimeout?.({ run } as never);
        else if (run.status === "completed") subscriber.onRunCompleted?.({ run } as never);
        else subscriber.onRunFailed?.({ run, error: `child exited with ${signal ?? `code ${code}`}` } as never);
        settle(run);
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        runs.delete(runId);
        const run: RunLike = { id: runId, agentName, status: "failed" };
        subscriber.onRunFailed?.({ run, error: err.message } as never);
        settle(run);
      });

      runs.set(runId, { child, done, timer });
      return runId;
    },

    async waitForRun(runId) {
      const live = runs.get(runId);
      return live ? ((await live.done) as never) : null;
    },

    async cancel(runId) {
      const live = runs.get(runId);
      if (!live) return false;
      live.child.kill("SIGTERM");
      return true;
    },

    async start() {
      /* nothing to poll — children are spawned on trigger */
    },

    async stop() {
      for (const { child, timer } of runs.values()) {
        clearTimeout(timer);
        child.kill("SIGTERM");
      }
      runs.clear();
    },
  };
}

/**
 * The child half: `glorp __agent-run <role>`. Builds the role's agent inline
 * (same construction as the continuum factory) and runs the triggered prompt.
 * Exit code is the run verdict; the parent owns timeouts.
 */
export async function runAgentSubcommand(role: string): Promise<number> {
  // Mirror agent-entrypoint.ts: Node/Bun Happy Eyeballs breaks on endpoints
  // with unreachable IPv6 records — disable before any fetch.
  const net = await import("node:net");
  net.setDefaultAutoSelectFamily(false);

  const { buildTriggeredRunnable } = await import("./agent-factory.ts");
  const { GlorpStore } = await import("../agent/store.ts");

  const input = JSON.parse(process.env.GLORP_AGENT_INPUT ?? "{}") as { prompt?: string };
  const config = {
    dataDir: process.env.GLORP_DATA_DIR ?? "",
    workspace: process.env.GLORP_WORKSPACE ?? process.cwd(),
    meshDir: process.env.GLORP_MESH_DIR ?? "",
  };
  if (!input.prompt) {
    console.error("[__agent-run] missing GLORP_AGENT_INPUT.prompt");
    return 1;
  }
  const uid = `${role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const store = new GlorpStore(uid, config.dataDir);
  try {
    const runnable = await buildTriggeredRunnable(role, config, { name: role, store });
    await runnable.processRequest(input.prompt);
    return 0;
  } catch (err) {
    console.error(`[__agent-run:${role}]`, err instanceof Error ? (err.stack ?? err.message) : String(err));
    return 1;
  }
}
