/** Orchestrator: main entry point for agent orchestration. Consumer-agnostic. */

import * as fs from "node:fs/promises";
import * as path from "node:path";
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
  upsertAgentRecord, markAgentStopped, markAllInterrupted,
  loadAgentRecords, pruneStaleRecords, type AgentRecord,
} from "./agent-state.ts";

const DEFAULT_MAX_AGENTS = 8;

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
      throw new Error(`Agent limit reached (${this.maxAgents}). Stop an agent before spawning.`);
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
      slot, status: "running", runId, spawnedAt: Date.now(),
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
    // Persist state first, then clean up mesh registration file.
    await markAgentStopped(this.meshDir, id, reason).catch(() => {});
    await fs.rm(path.join(this.meshDir, "agents", `${id}.json`), { force: true }).catch(() => {});
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
