/**
 * ContinuumRunner setup for orchestrated agents.
 * Creates and configures the runner, registers agent definitions,
 * and maps lifecycle events to OrchestratorEvents.
 */

import { ContinuumRunner, MemoryAdapter } from "glove-continuum-signal";
import type { ContinuumSubscriber, TriggeredAgent, Run } from "glove-continuum-signal";
import type { OrchestratorEvent } from "./types.ts";
import { agentId } from "./types.ts";
import { defineOrchestratorAgent } from "./agent-factory.ts";

const AGENT_ROLES = ["generator", "evaluator", "researcher", "builder"] as const;

export interface RunnerHandle {
  trigger(agentName: string, input: unknown): Promise<string>;
  waitForRun(runId: string): Promise<Run | null>;
  cancel(runId: string): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createOrchestratorRunner(
  config: { dataDir: string; workspace: string; meshDir: string },
  emit: (event: OrchestratorEvent) => void,
): RunnerHandle {
  const adapter = new MemoryAdapter();
  const subscriber = buildSubscriber(emit);
  const runner = new ContinuumRunner({
    adapter,
    subscribers: [subscriber],
    pollIntervalMs: 50,
    maxConcurrent: 6,
  });

  const agents = new Map<string, TriggeredAgent<any, any>>();
  for (const role of AGENT_ROLES) {
    const agentDef = defineOrchestratorAgent(role, config);
    runner.registerAgent(agentDef, `orchestrator/${role}`);
    agents.set(role, agentDef);
  }

  return {
    async trigger(agentName, input) {
      const agentDef = agents.get(agentName);
      if (!agentDef) throw new Error(`Unknown agent role: ${agentName}`);
      return agentDef.trigger(input);
    },
    async waitForRun(runId) {
      return runner.waitForRun(runId, { timeoutMs: 300_000 });
    },
    async cancel(runId) {
      return runner.cancel(runId);
    },
    async start() {
      await runner.start();
    },
    async stop() {
      await runner.stop({ graceful: true, timeoutMs: 5_000 });
    },
  };
}

function buildSubscriber(emit: (event: OrchestratorEvent) => void): ContinuumSubscriber {
  return {
    onRunStarted({ run }) {
      emit({
        type: "agent_spawned",
        agent: {
          id: agentId(run.agentName),
          role: "autonomous",
          slot: "background",
          phase: "generating",
          label: run.agentName,
        },
      });
    },
    onRunCompleted({ run }) {
      emit({
        type: "agent_stopped",
        id: agentId(run.agentName),
        reason: "completed",
      });
    },
    onRunFailed({ run, error }) {
      emit({
        type: "error",
        agent: agentId(run.agentName),
        message: `Agent failed: ${error ?? "unknown error"}`,
      });
    },
  };
}
