/**
 * No-op DisplayManager for background agents.
 * pushAndForget is silently swallowed. pushAndWait rejects immediately
 * so background agents never block on user interaction.
 */

import type { DisplayManagerAdapter, Renderer, Slot, ListenerFn, Resolver } from "glove-core/display-manager";

export class NoopDisplayManager implements DisplayManagerAdapter {
  renderers: Array<Renderer<unknown, unknown>> = [];
  stack: Array<Slot<unknown>> = [];
  listeners = new Set<ListenerFn>();
  resolverStore = new Map<string, Resolver<any>>();
  private slotCounter = 0;

  registerRenderer<I, O>(_renderer: Renderer<I, O>): void {
    // Background agents don't render UI.
  }

  async pushAndForget<I>(_slot: Omit<Slot<I>, "id">): Promise<string> {
    return `noop_slot_${++this.slotCounter}`;
  }

  async pushAndWait<I, O>(_slot: Omit<Slot<I>, "id">): Promise<O> {
    throw new Error(
      "Background agent attempted pushAndWait. " +
      "Use request_promotion to switch to foreground before requesting user input.",
    );
  }

  async notify(): Promise<void> {}

  subscribe(_listener: ListenerFn): () => void {
    return () => {};
  }

  resolve<O>(_slotId: string, _value: O): void {}

  reject(_slotId: string, _error: any): void {}

  removeSlot(_id: string): void {}

  async clearStack(): Promise<void> {}
}
