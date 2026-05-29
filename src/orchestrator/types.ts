/**
 * Core type vocabulary for the orchestrator.
 * All primitives are consumer-agnostic — the CLI is one of many frontends.
 */

import type { ModelAdapter, SubscriberAdapter } from "glove-core/core";
import type { ResourceFsAdapter } from "glove-memory";

/** Unique branded identifier for an orchestrated agent. */
export type AgentId = string & { readonly __brand: "AgentId" };

/** The two fundamental roles in a generate-evaluate loop. */
export type LoopRole = "generator" | "evaluator";

/** Named gate where the evaluator decides: proceed, retry, or terminate. */
export interface Checkpoint {
  name: string;
  description: string;
  /** Criteria the evaluator checks before allowing passage. */
  criteria: string[];
}

/** Evaluator's verdict at a checkpoint. */
export type Verdict =
  | { action: "proceed"; note?: string }
  | { action: "retry"; feedback: string; maxRetries?: number }
  | { action: "terminate"; reason: string };

/** Phase the loop is currently in. */
export type LoopPhase =
  | "idle"
  | "generating"
  | "evaluating"
  | "checkpoint"
  | "terminated"
  | "completed";

/** Scheduling slot: one foreground, many background. */
export type Slot = "foreground" | "background";

/** Runtime state of a scheduled agent. */
export interface AgentSlot {
  id: AgentId;
  role: LoopRole | "autonomous";
  slot: Slot;
  phase: LoopPhase;
  label: string;
}

/** Everything needed to construct an agent at runtime. */
export interface AgentBlueprint {
  id: AgentId;
  label: string;
  role: LoopRole | "autonomous";
  /** Role registry key (e.g. "researcher", "builder"). Drives subprocess agent selection. */
  registryRole?: string;
  systemPrompt: string;
  tools: string[];
  /** Capabilities advertised on the mesh network. */
  capabilities?: string[];
  /** User-provided custom context to forward to subprocess (not the default role prompt). */
  customContext?: string;
}

/** Emitted to consumers whenever orchestrator state changes. */
export type OrchestratorEvent =
  | { type: "agent_spawned"; agent: AgentSlot }
  | { type: "agent_stopped"; id: AgentId; reason: string; runId?: string }
  | { type: "slot_switched"; promoted: AgentId; demoted: AgentId }
  | { type: "slot_forwarded"; slotId: string; renderer: string; input: unknown; agentId: string }
  | { type: "loop_phase"; loopId: string; phase: LoopPhase }
  | { type: "verdict"; loopId: string; checkpoint: string; verdict: Verdict }
  | { type: "plan_created"; path: string; title: string }
  | { type: "plan_accepted"; path: string }
  | { type: "agent_stats"; agentId: string; label: string; role: string; phase: LoopPhase; turns: number; tokensIn: number; tokensOut: number }
  | { type: "error"; agent?: AgentId; message: string; detail?: string };

export type OrchestratorListener = (event: OrchestratorEvent) => void;

/** Handle to a running agent managed by the orchestrator. */
export interface ManagedAgent {
  id: AgentId;
  blueprint: AgentBlueprint;
  slot: Slot;
  runId: string;
  abortController: AbortController;
}

/** Options for a generate-evaluate loop run. */
export interface GenEvalLoopOptions {
  loopId: string;
  generatorBlueprint: AgentBlueprint;
  evaluatorBlueprint: AgentBlueprint;
  checkpoints: Checkpoint[];
  initialPrompt: string;
  maxRetries?: number;
  foregroundRole?: LoopRole;
  /** Optional hook to enrich the generator's text artifact before the evaluator
   *  sees it — e.g. appending a plan read from the resource filesystem. */
  enrichArtifact?: (text: string) => Promise<string>;
}

/** Consumer-supplied configuration for the orchestrator runtime. */
export interface OrchestratorConfig {
  workspace: string;
  dataDir: string;
  /** Session-scoped mesh directory for inter-agent communication. */
  meshDir: string;
  model: ModelAdapter;
  /** Resolved model config for subprocess agents — see runner.ts env propagation. */
  subprocessModel?: {
    providerId: string;
    model: string;
    baseURL?: string;
    apiKey?: string;
  };
  /** Context window size (tokens) inherited by loop agents for compaction. */
  contextLimit: number;
  resources: ResourceFsAdapter;
  /** Maximum concurrent agents (default 8). */
  maxAgents?: number;
  /** Per-agent timeout in milliseconds (default 600_000 = 10 minutes). */
  agentTimeoutMs?: number;
  /** Factory for subscribers attached to loop agents for UI observability. */
  loopSubscriberFactory?: () => SubscriberAdapter;
  /** Pre-computed workspace context block for agent prompt injection. */
  workspaceContext?: string;
}

/** Convenience: mint an AgentId from a plain string. */
export function agentId(raw: string): AgentId {
  return raw as AgentId;
}
