import type { BridgeEvent, BridgeListener } from "./events.ts";

/**
 * Tiny pub-sub the agent half writes to and the TUI half reads from.
 * Synchronous fan-out — both halves are in the same event loop.
 */
export class Bridge {
  private listeners = new Set<BridgeListener>();

  subscribe(fn: BridgeListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event: BridgeEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (err) {
        // Don't let a UI handler crash the agent.
        console.error("[bridge] listener threw:", err);
      }
    }
  }
}

let _global: Bridge | undefined;

export function getBridge(): Bridge {
  if (!_global) _global = new Bridge();
  return _global;
}
