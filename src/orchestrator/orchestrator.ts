/** Orchestrator: main entry point for agent orchestration. Consumer-agnostic. */

import * as fs from "node:fs/promises";
import type { DisplayManagerAdapter } from "glove-core/display-manager";
import type {
  AgentBlueprint,
  AgentId,
  GenEvalLoopOptions,
  ManagedAgent,
  OrchestratorConfig,
  OrchestratorEvent,
  OrchestratorListener,
  Slot,
  Verdict,
} from "./types.ts";
import { OrchestratorEventBus } from "./events.ts";
import { Scheduler } from "./scheduler.ts";
import { createOrchestratorRunner, type RunnerHandle } from "./runner.ts";
import { blueprintToInput } from "./agent-factory.ts";
import { runGenEvalLoop } from "./gen-eval-loop.ts";
import { runPlanPhase, type PlanResult } from "./plan-phase.ts";
import type { ForwardingDisplayManager } from "./forwarding-display.ts";
import {
  upsertAgentRecord, markAgentStopped, markAllInterrupted, setAgentState,
  loadAgentRecords, pruneStaleRecords, type AgentRecord,
} from "./agent-state.ts";
import { agentId } from "./types.ts";
import type { AgentProcessingState, LoopPhase } from "./types.ts";

const DEFAULT_MAX_AGENTS = 5;

export class Orchestrator {
  private eventBus = new OrchestratorEventBus();
  private scheduler: Scheduler;
  private runner: RunnerHandle;
  private agents = new Map<AgentId, ManagedAgent>();
  /** Maps forwarded slot IDs to the display manager that owns the pending promise. */
  private forwardedSlots = new Map<string, ForwardingDisplayManager>();
  private config: OrchestratorConfig;
  private meshDir: string;
  private maxAgents: number;
  private started = false;
  private runnerStartPromise: Promise<void> | null = null;

  constructor(config: OrchestratorConfig, display: DisplayManagerAdapter) {
    this.config = config;
    this.meshDir = config.meshDir;
    this.maxAgents = config.maxAgents ?? DEFAULT_MAX_AGENTS;
    this.scheduler = new Scheduler(display, (e) => this.eventBus.emit(e));
    const sm = config.subprocessModel;
    this.runner = createOrchestratorRunner(
      { dataDir: config.dataDir, workspace: config.workspace, meshDir: this.meshDir,
        providerId: sm?.providerId, modelName: sm?.model, baseURL: sm?.baseURL, apiKey: sm?.apiKey,
        agentTimeoutMs: config.agentTimeoutMs, workspaceContext: config.workspaceContext },
      (e) => { this.eventBus.emit(e); this.handleRunnerEvent(e); },
    );
    // Keep each agent's persisted processing state current so peers (via
    // list_agents / the mesh roster) can tell who is busy.
    this.eventBus.subscribe((e) => this.trackAgentState(e));
  }

  /** Map loop activity to a processing state and persist it for the agent. */
  private trackAgentState(e: OrchestratorEvent): void {
    if (e.type !== "agent_stats") return;
    const state = phaseToProcessingState(e.phase);
    if (state) void setAgentState(this.meshDir, agentId(e.agentId), state).catch(() => {});
  }

  /** Reconcile runner lifecycle events with managed agent state. */
  private handleRunnerEvent(e: OrchestratorEvent): void {
    if (e.type !== "agent_stopped" || !e.runId) return;
    for (const [id, agent] of this.agents) {
      if (agent.runId === e.runId) {
        this.agents.delete(id);
        this.scheduler.unregister(id);
        void markAgentStopped(this.meshDir, id, e.reason).catch(() => {});
        return;
      }
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    await fs.mkdir(this.meshDir, { recursive: true });
    await pruneStaleRecords(this.meshDir).catch(() => {});
    this.started = true;
  }

  /** Load agent records from disk (for hydration on resume). */
  async loadPersistedAgents(): Promise<AgentRecord[]> {
    return loadAgentRecords(this.meshDir);
  }

  private async ensureRunnerStarted(): Promise<void> {
    if (!this.runnerStartPromise) this.runnerStartPromise = this.runner.start();
    await this.runnerStartPromise;
  }

  subscribe(fn: OrchestratorListener): () => void {
    return this.eventBus.subscribe(fn);
  }

  /**
   * Spawn an agent from a blueprint in the given slot.
   * The agent runs as a continuum subprocess and is registered with the scheduler.
   */
  async spawnAgent(blueprint: AgentBlueprint, slot: Slot, prompt: string): Promise<ManagedAgent> {
    await this.ensureRunnerStarted();
    if (this.agents.size >= this.maxAgents) {
      const busy = [...this.agents.values()]
        .map((a) => `${a.blueprint.label} (${a.blueprint.role})`)
        .join(", ");
      throw new Error(
        `Agent limit reached (${this.agents.size}/${this.maxAgents}). ` +
        `These agents are still busy: ${busy || "unknown"}. ` +
        `Wait for one to finish (use list_agents to check) or stop one before spawning another.`,
      );
    }

    const input = blueprintToInput(blueprint, prompt, {
      workspace: this.config.workspace,
      dataDir: this.config.dataDir,
    });

    const roleName = blueprint.registryRole ?? (blueprint.role === "autonomous" ? "builder" : blueprint.role);
    const runId = await this.runner.trigger(roleName, input);
    const managed: ManagedAgent = {
      id: blueprint.id,
      blueprint,
      slot,
      runId,
      abortController: new AbortController(),
    };

    this.agents.set(blueprint.id, managed);
    this.scheduler.register(managed, slot);
    void upsertAgentRecord(this.meshDir, {
      id: blueprint.id, label: blueprint.label, role: blueprint.role,
      slot, status: "running", state: "thinking", stateSince: Date.now(),
      runId, spawnedAt: Date.now(),
    }).catch(() => {});
    this.eventBus.emit({
      type: "agent_spawned",
      agent: { id: blueprint.id, role: blueprint.role, slot, phase: "generating", label: blueprint.label },
    });
    return managed;
  }

  async stopAgent(id: AgentId, reason = "stopped by orchestrator"): Promise<void> {
    const agent = this.agents.get(id);
    if (!agent) return;
    agent.abortController.abort();
    await this.runner.cancel(agent.runId).catch(() => {});
    this.scheduler.unregister(id);
    this.agents.delete(id);
    // Persist stopped state. Mesh identity file stays — future agents need it.
    await markAgentStopped(this.meshDir, id, reason).catch(() => {});
    this.eventBus.emit({ type: "agent_stopped", id, reason });
  }

  /** Shared context for gen-eval loop and plan phase. */
  private loopCtx(signal?: AbortSignal) {
    return {
      model: this.config.model, contextLimit: this.config.contextLimit,
      emit: (e: OrchestratorEvent) => this.eventBus.emit(e),
      workspace: this.config.workspace, dataDir: this.config.dataDir,
      meshDir: this.meshDir, resources: this.config.resources,
      trackForwardedSlot: (slotId: string, dm: ForwardingDisplayManager) => this.forwardedSlots.set(slotId, dm),
      createSubscriber: this.config.loopSubscriberFactory, signal, workspaceContext: this.config.workspaceContext,
    };
  }

  /** Run a generate-evaluate loop through a series of checkpoints. */
  async runLoop(opts: GenEvalLoopOptions, signal?: AbortSignal): Promise<Verdict> {
    return runGenEvalLoop(opts, this.loopCtx(signal));
  }

  /** Run the plan phase: requirements → plan → user acceptance. */
  async planPhase(prompt: string, signal?: AbortSignal): Promise<PlanResult> {
    return runPlanPhase(prompt, this.loopCtx(signal));
  }

  /** Promote a background agent to foreground. */
  promoteAgent(id: AgentId): boolean { return this.scheduler.promote(id); }

  get agentCount(): number { return this.agents.size; }
  getAgent(id: AgentId): ManagedAgent | undefined { return this.agents.get(id); }
  hasForwardedSlot(slotId: string): boolean { return this.forwardedSlots.has(slotId); }

  resolveForwardedSlot(slotId: string, value: unknown): boolean {
    const dm = this.forwardedSlots.get(slotId);
    if (!dm) return false;
    dm.resolve(slotId, value);
    this.forwardedSlots.delete(slotId);
    return true;
  }

  rejectForwardedSlot(slotId: string, reason: unknown): boolean {
    const dm = this.forwardedSlots.get(slotId);
    if (!dm) return false;
    dm.reject(slotId, reason);
    this.forwardedSlots.delete(slotId);
    return true;
  }

  async shutdown(): Promise<void> {
    await markAllInterrupted(this.meshDir).catch(() => {});
    for (const id of [...this.agents.keys()]) await this.stopAgent(id, "orchestrator shutting down");
    for (const [slotId, dm] of this.forwardedSlots) dm.reject(slotId, new Error("Orchestrator shutting down"));
    this.forwardedSlots.clear();
    if (this.runnerStartPromise) {
      await this.runnerStartPromise.catch(() => {});
      await this.runner.stop();
      this.runnerStartPromise = null;
    }
    this.started = false;
  }
}

/** Translate a loop phase into the agent's coarse processing state. */
function phaseToProcessingState(phase: LoopPhase): AgentProcessingState | null {
  switch (phase) {
    case "generating": return "thinking";
    case "evaluating":
    case "checkpoint": return "working";
    case "idle": return "idle";
    case "completed": return "done";
    case "terminated": return "dead";
    default: return null;
  }
}
