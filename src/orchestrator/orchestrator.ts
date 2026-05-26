/**
 * Orchestrator: the main entry point for agent orchestration.
 * Consumer-agnostic — the CLI wires this to the Bridge; tests use it directly.
 */

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
    this.runner = createOrchestratorRunner(
      { dataDir: config.dataDir, workspace: config.workspace, meshDir: this.meshDir },
      (e) => this.eventBus.emit(e),
    );
  }

  async start(): Promise<void> {
    if (this.started) return;
    await fs.mkdir(this.meshDir, { recursive: true });
    this.started = true;
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

    const roleName = blueprint.role === "autonomous" ? "builder" : blueprint.role;
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
    this.eventBus.emit({
      type: "agent_spawned",
      agent: {
        id: blueprint.id,
        role: blueprint.role,
        slot,
        phase: "generating",
        label: blueprint.label,
      },
    });

    return managed;
  }

  async stopAgent(id: AgentId, reason = "stopped by orchestrator"): Promise<void> {
    const agent = this.agents.get(id);
    if (!agent) return;
    agent.abortController.abort();
    await this.runner.cancel(agent.runId).catch(() => {});
    await fs.rm(path.join(this.meshDir, "agents", `${id}.json`), { force: true }).catch(() => {});
    this.scheduler.unregister(id);
    this.agents.delete(id);
    this.eventBus.emit({ type: "agent_stopped", id, reason });
  }

  /**
   * Run a generate-evaluate loop through a series of checkpoints.
   * Loop agents run in-process so permission requests can be forwarded.
   */
  async runLoop(opts: GenEvalLoopOptions, signal?: AbortSignal): Promise<Verdict> {
    return runGenEvalLoop(opts, {
      model: this.config.model,
      contextLimit: this.config.contextLimit,
      emit: (e) => this.eventBus.emit(e),
      workspace: this.config.workspace,
      dataDir: this.config.dataDir,
      meshDir: this.meshDir,
      resources: this.config.resources,
      trackForwardedSlot: (slotId, dm) => this.forwardedSlots.set(slotId, dm),
      createSubscriber: this.config.loopSubscriberFactory,
      signal,
    });
  }

  /**
   * Run the plan phase: requirements gathering → plan creation → user acceptance.
   */
  async planPhase(prompt: string, signal?: AbortSignal): Promise<PlanResult> {
    return runPlanPhase(prompt, {
      model: this.config.model,
      contextLimit: this.config.contextLimit,
      emit: (e) => this.eventBus.emit(e),
      resources: this.config.resources,
      workspace: this.config.workspace,
      dataDir: this.config.dataDir,
      meshDir: this.meshDir,
      trackForwardedSlot: (slotId, dm) => this.forwardedSlots.set(slotId, dm),
      createSubscriber: this.config.loopSubscriberFactory,
      signal,
    });
  }

  get agentCount(): number {
    return this.agents.size;
  }

  getAgent(id: AgentId): ManagedAgent | undefined {
    return this.agents.get(id);
  }

  /** Check if a slot belongs to a background agent's forwarded permission. */
  hasForwardedSlot(slotId: string): boolean {
    return this.forwardedSlots.has(slotId);
  }

  /** Resolve a forwarded permission slot (grants or denies the tool). */
  resolveForwardedSlot(slotId: string, value: unknown): boolean {
    const dm = this.forwardedSlots.get(slotId);
    if (!dm) return false;
    dm.resolve(slotId, value);
    this.forwardedSlots.delete(slotId);
    return true;
  }

  /** Reject a forwarded permission slot. */
  rejectForwardedSlot(slotId: string, reason: unknown): boolean {
    const dm = this.forwardedSlots.get(slotId);
    if (!dm) return false;
    dm.reject(slotId, reason);
    this.forwardedSlots.delete(slotId);
    return true;
  }

  async shutdown(): Promise<void> {
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
