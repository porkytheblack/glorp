/**
 * No-op DisplayManager for background agents.
 *
 * pushAndForget is silently swallowed. pushAndWait auto-resolves
 * permission requests (background agents don't have a user to prompt)
 * and rejects anything else. Background agents should use
 * request_promotion to switch to foreground for real user interaction.
 */

import type {
  DisplayManagerAdapter, Renderer, Slot, ListenerFn, Resolver,
} from "glove-core/display-manager";

export class NoopDisplayManager implements DisplayManagerAdapter {
  renderers: Array<Renderer<unknown, unknown>> = [];
  stack: Array<Slot<unknown>> = [];
  listeners = new Set<ListenerFn>();
  resolverStore = new Map<string, Resolver<any>>();
  private slotCounter = 0;

  registerRenderer<I, O>(_renderer: Renderer<I, O>): void {}

  async pushAndForget<I>(_slot: Omit<Slot<I>, "id">): Promise<string> {
    return `noop_slot_${++this.slotCounter}`;
  }

  async pushAndWait<I, O>(slot: Omit<Slot<I>, "id">): Promise<O> {
    // Auto-approve permission requests so background agents can use
    // write/edit/bash without hanging. The orchestrator already
    // approved the agent spawn — tool-level re-confirmation is
    // redundant for subprocess work.
    const renderer = (slot as any).renderer as string | undefined;
    if (renderer === "permission_request") return true as O;
    throw new Error(
      "Background agent attempted pushAndWait on a non-permission slot. " +
      "Use request_promotion to switch to foreground first.",
    );
  }

  async notify(): Promise<void> {}

  subscribe(_listener: ListenerFn): () => void { return () => {}; }

  resolve<O>(_slotId: string, _value: O): void {}
  reject(_slotId: string, _error: any): void {}
  removeSlot(_id: string): void {}
  async clearStack(): Promise<void> {}
}
