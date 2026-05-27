/**
 * Typed event bus for orchestrator events.
 * Consumer-agnostic — the CLI maps these to BridgeEvents, tests collect them.
 */

import type { OrchestratorEvent, OrchestratorListener } from "./types.ts";

export class OrchestratorEventBus {
  private listeners = new Set<OrchestratorListener>();

  subscribe(fn: OrchestratorListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(event: OrchestratorEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (err) {
        console.error("[orchestrator] listener threw:", err);
      }
    }
  }
}
