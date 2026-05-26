/**
 * Foreground/background slot manager.
 * Invariant: at most one agent in the foreground slot at any time.
 */

import type { DisplayManagerAdapter } from "glove-core/display-manager";
import type { AgentId, ManagedAgent, Slot, OrchestratorEvent } from "./types.ts";
import { NoopDisplayManager } from "./noop-display.ts";

export interface PromotionRequest {
  agentId: AgentId;
  reason: string;
}

export class Scheduler {
  private foregroundId: AgentId | null = null;
  private backgroundIds = new Set<AgentId>();
  private agents = new Map<AgentId, ManagedAgent>();
  private promotionQueue: PromotionRequest[] = [];
  private realDisplay: DisplayManagerAdapter;
  private noopDisplay = new NoopDisplayManager();
  private emitFn: (event: OrchestratorEvent) => void;

  constructor(
    realDisplay: DisplayManagerAdapter,
    emit: (event: OrchestratorEvent) => void,
  ) {
    this.realDisplay = realDisplay;
    this.emitFn = emit;
  }

  /** Register a managed agent in the given slot. */
  register(agent: ManagedAgent, slot: Slot): void {
    this.agents.set(agent.id, agent);
    if (slot === "foreground") {
      if (this.foregroundId) {
        this.demoteInternal(this.foregroundId);
      }
      this.foregroundId = agent.id;
    } else {
      this.backgroundIds.add(agent.id);
    }
  }

  /** Remove an agent from scheduling. */
  unregister(id: AgentId): void {
    this.agents.delete(id);
    if (this.foregroundId === id) {
      this.foregroundId = null;
      this.drainPromotionQueue();
    } else {
      this.backgroundIds.delete(id);
    }
    this.promotionQueue = this.promotionQueue.filter((r) => r.agentId !== id);
  }

  /** Get the display manager appropriate for a slot. */
  displayFor(slot: Slot): DisplayManagerAdapter {
    return slot === "foreground" ? this.realDisplay : this.noopDisplay;
  }

  /** Promote a background agent to foreground. */
  promote(id: AgentId): boolean {
    if (!this.backgroundIds.has(id)) return false;
    const demotedId = this.foregroundId;
    if (demotedId) {
      this.demoteInternal(demotedId);
    }
    this.backgroundIds.delete(id);
    this.foregroundId = id;
    if (demotedId) {
      this.emitFn({ type: "slot_switched", promoted: id, demoted: demotedId });
    }
    return true;
  }

  /** Queue a promotion request; granted when foreground slot is free. */
  requestPromotion(req: PromotionRequest): void {
    if (this.foregroundId === null) {
      this.promote(req.agentId);
      return;
    }
    this.promotionQueue.push(req);
  }

  /** Check if a specific agent is currently foreground. */
  isForeground(id: AgentId): boolean {
    return this.foregroundId === id;
  }

  get currentForeground(): AgentId | null {
    return this.foregroundId;
  }

  get backgroundCount(): number {
    return this.backgroundIds.size;
  }

  get totalAgents(): number {
    return this.agents.size;
  }

  private demoteInternal(id: AgentId): void {
    if (this.foregroundId === id) {
      this.foregroundId = null;
    }
    this.backgroundIds.add(id);
  }

  private drainPromotionQueue(): void {
    while (this.foregroundId === null && this.promotionQueue.length > 0) {
      const next = this.promotionQueue.shift()!;
      if (this.backgroundIds.has(next.agentId)) {
        this.promote(next.agentId);
        return;
      }
    }
  }
}
