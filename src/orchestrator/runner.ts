/**
 * ContinuumRunner setup for orchestrated agents.
 * Creates and configures the runner, registers agent definitions,
 * and maps lifecycle events to OrchestratorEvents.
 */

import { statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ContinuumRunner, MemoryAdapter } from "glove-continuum-signal";
import type { ContinuumSubscriber, TriggeredAgent, Run } from "glove-continuum-signal";
import type { OrchestratorEvent } from "./types.ts";
import { agentId } from "./types.ts";
import { defineOrchestratorAgent } from "./agent-factory.ts";
import { createCompiledRunner } from "./compiled-runner.ts";

const AGENT_ROLES = ["generator", "evaluator", "researcher", "builder"] as const;
const ENTRYPOINT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "agent-entrypoint.ts");

// Bun's import.meta.resolve returns a path inside Bun's global cache, but
// the node subprocess needs the project-local tsx so it can find esbuild.
// Resolve through the filesystem to avoid Bun's cache redirect.
if (!process.env.__CONTINUUM_TSX) {
  const candidates = [
    path.resolve("node_modules/tsx/dist/loader.mjs"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../node_modules/tsx/dist/loader.mjs"),
  ];
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) {
        process.env.__CONTINUUM_TSX = pathToFileURL(c).href;
        break;
      }
    } catch { /* try next */ }
  }
}

export interface RunnerHandle {
  trigger(agentName: string, input: unknown): Promise<string>;
  waitForRun(runId: string): Promise<Run | null>;
  cancel(runId: string): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

const DEFAULT_AGENT_TIMEOUT_MS = 600_000; // 10 minutes

/** True when the dev entrypoint exists as a real file — i.e. running from
 * source. The compiled binary's paths live in bunfs and statSync fails. */
function entrypointOnDisk(): boolean {
  try {
    return statSync(ENTRYPOINT).isFile();
  } catch {
    return false;
  }
}

export function createOrchestratorRunner(
  config: {
    dataDir: string; workspace: string; meshDir: string;
    providerId?: string; modelName?: string;
    baseURL?: string; apiKey?: string;
    agentTimeoutMs?: number;
    workspaceContext?: string;
  },
  emit: (event: OrchestratorEvent) => void,
): RunnerHandle {
  const timeoutMs = config.agentTimeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
  const subscriber = buildSubscriber(emit);

  // Env vars subprocess agents need — set BEFORE any spawn path, shared by
  // both runner flavors (children inherit process.env).
  process.env.GLORP_WORKSPACE = config.workspace;
  process.env.GLORP_DATA_DIR = config.dataDir;
  process.env.GLORP_MESH_DIR = config.meshDir;
  if (config.providerId) process.env.GLORP_MODEL_PROVIDER = config.providerId;
  if (config.modelName) process.env.GLORP_MODEL_NAME = config.modelName;
  if (config.baseURL) process.env.GLORP_MODEL_BASE_URL = config.baseURL;
  if (config.apiKey) process.env.GLORP_MODEL_API_KEY = config.apiKey;
  process.env.GLORP_AGENT_TIMEOUT = String(timeoutMs);
  if (config.workspaceContext) process.env.GLORP_WORKSPACE_CONTEXT = config.workspaceContext;

  // Compiled binary: import.meta.url is a virtual /$bunfs path — the
  // node-bootstrap spawn cannot work ("Cannot find module
  // '/$bunfs/root/bootstrap.js'"). Spawn the binary itself instead.
  if (!entrypointOnDisk()) {
    return createCompiledRunner(timeoutMs, subscriber);
  }

  const adapter = new MemoryAdapter();
  const runner = new ContinuumRunner({
    adapter,
    subscribers: [subscriber],
    pollIntervalMs: 50,
    maxConcurrent: 5,
  });

  // Import the entrypoint to get the real agent definitions (same objects
  // the subprocess bootstrap will import). Register them with the path to
  // the entrypoint file so the subprocess can find them.
  const agents = new Map<string, TriggeredAgent<any, any>>();
  for (const role of AGENT_ROLES) {
    const agentDef = defineOrchestratorAgent(role, { ...config, agentTimeoutMs: timeoutMs });
    runner.registerAgent(agentDef, ENTRYPOINT);
    agents.set(role, agentDef);
  }

  return {
    async trigger(agentName, input) {
      const agentDef = agents.get(agentName);
      if (!agentDef) throw new Error(`Unknown agent role: ${agentName}`);
      return agentDef.trigger(input);
    },
    async waitForRun(runId) {
      return runner.waitForRun(runId, { timeoutMs });
    },
    async cancel(runId) {
      return runner.cancel(runId);
    },
    async start() {
      // ContinuumRunner.start() is a blocking polling loop (while(running) …)
      // that never resolves until stop() is called. Fire-and-forget it and
      // yield one tick so the loop is running before we return.
      void runner.start();
      await new Promise((r) => setTimeout(r, 0));
    },
    async stop() {
      await runner.stop({ graceful: true, timeoutMs: 5_000 });
    },
  };
}

/** Lines of recent subprocess stderr kept per agent, attached to failures so a
 *  silent "exited unexpectedly" still carries the real crash output. */
const STDERR_BUFFER_LINES = 40;

function buildSubscriber(emit: (event: OrchestratorEvent) => void): ContinuumSubscriber {
  const stderrByAgent = new Map<string, string[]>();
  const pushStderr = (agentName: string, message: string) => {
    const buf = stderrByAgent.get(agentName) ?? [];
    for (const line of message.split("\n")) if (line.trim()) buf.push(line);
    stderrByAgent.set(agentName, buf.slice(-STDERR_BUFFER_LINES));
  };
  const drainStderr = (agentName: string): string | undefined => {
    const buf = stderrByAgent.get(agentName);
    stderrByAgent.delete(agentName);
    return buf?.length ? buf.join("\n") : undefined;
  };
  return {
    // onRunStarted intentionally omitted — the orchestrator emits agent_spawned
    // with correct role/slot from spawnAgent(). The runner only tracks completion.
    onRunCompleted({ run }) {
      stderrByAgent.delete(run.agentName);
      emit({
        type: "agent_stopped",
        id: agentId(run.agentName),
        reason: "completed",
        runId: run.id,
      });
    },
    onRunFailed({ run, error }) {
      const detail = drainStderr(run.agentName);
      emit({
        type: "error",
        agent: agentId(run.agentName),
        message: `Agent failed: ${error ?? "unknown error"}`,
        detail,
      });
      emit({
        type: "agent_stopped",
        id: agentId(run.agentName),
        reason: `failed: ${error ?? "unknown error"}`,
        runId: run.id,
      });
    },
    onRunTimeout({ run }) {
      const detail = drainStderr(run.agentName);
      emit({
        type: "error",
        agent: agentId(run.agentName),
        message: `Agent timed out`,
        detail,
      });
      emit({
        type: "agent_stopped",
        id: agentId(run.agentName),
        reason: "timed out",
        runId: run.id,
      });
    },
    onLogOutput({ agentName, level, message }) {
      const tag = `[orchestrator:${agentName}:${level}]`;
      if (level === "stderr") { pushStderr(agentName, message); console.error(tag, message); }
      else console.log(tag, message);
    },
    onAgentTerminated({ agentName, reason }) {
      pushStderr(agentName, `terminated: ${reason}`);
      console.error(`[orchestrator:${agentName}:terminated]`, reason);
    },
  };
}
