/**
 * Forwarding DisplayManager for orchestrated agents.
 * pushAndWait calls are forwarded to the orchestrator via a callback so
 * the consumer can surface them.
 *
 * Two modes:
 *  - **forwardAll** (foreground loop agents) — every slot type is forwarded.
 *  - **permissions-only** (background agents) — only `permission_request`
 *    slots are forwarded; everything else is auto-rejected.
 */

import type {
  DisplayManagerAdapter,
  Renderer,
  Slot,
  ListenerFn,
  Resolver,
} from "glove-core/display-manager";

/** Payload emitted when a background agent needs a permission decision. */
export interface ForwardedSlot {
  slotId: string;
  renderer: string;
  input: unknown;
  agentId: string;
}

export type SlotForwardCallback = (slot: ForwardedSlot) => void;

type Pending = { resolve: (v: any) => void; reject: (e: any) => void };

export class ForwardingDisplayManager implements DisplayManagerAdapter {
  renderers: Array<Renderer<unknown, unknown>> = [];
  stack: Array<Slot<unknown>> = [];
  listeners = new Set<ListenerFn>();
  resolverStore = new Map<string, Resolver<any>>();

  private counter = 0;
  private pending = new Map<string, Pending>();

  constructor(
    private agentId: string,
    private onForward: SlotForwardCallback,
    private forwardAll = false,
  ) {}

  registerRenderer<I, O>(_renderer: Renderer<I, O>): void {}

  async pushAndForget<I>(_slot: Omit<Slot<I>, "id">): Promise<string> {
    return `fwd_${++this.counter}`;
  }

  /**
   * Forward a slot to the consumer. In permissions-only mode, non-permission
   * slots are rejected so background agents don't block on UX.
   */
  async pushAndWait<I, O>(slot: Omit<Slot<I>, "id">): Promise<O> {
    if (!this.forwardAll && slot.renderer !== "permission_request") {
      throw new Error(
        "Background agent attempted non-permission pushAndWait. " +
        "Only permission_request slots are forwarded to the consumer.",
      );
    }

    const slotId = `fwd_${this.agentId}_${++this.counter}`;
    return new Promise<O>((resolve, reject) => {
      this.pending.set(slotId, { resolve, reject });
      this.onForward({ slotId, renderer: slot.renderer, input: slot.input, agentId: this.agentId });
    });
  }

  resolve<O>(slotId: string, value: O): void {
    const entry = this.pending.get(slotId);
    if (!entry) return;
    this.pending.delete(slotId);
    entry.resolve(value);
  }

  reject(slotId: string, error: any): void {
    const entry = this.pending.get(slotId);
    if (!entry) return;
    this.pending.delete(slotId);
    entry.reject(error);
  }

  hasPending(slotId: string): boolean {
    return this.pending.has(slotId);
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  async notify(): Promise<void> {}
  subscribe(_listener: ListenerFn): () => void { return () => {}; }
  removeSlot(_id: string): void {}

  async clearStack(): Promise<void> {
    for (const [, entry] of this.pending) {
      entry.reject(new Error("Display stack cleared"));
    }
    this.pending.clear();
  }
}
