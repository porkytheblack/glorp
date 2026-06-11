import type { Displaymanager } from "glove-core/display-manager";
import type { BridgeEvent, BridgeListener, DisplaySlotEvent } from "../../shared/events.ts";

interface Bridge {
  emit(event: BridgeEvent): void;
  subscribe(listener: BridgeListener): () => void;
}

export interface DisplaySlotBridge {
  /** Currently-open slots, for replay on hydrate/resync — a client that
   * connects after the push would otherwise never see a pending prompt. */
  openSlots(): DisplaySlotEvent[];
}

export function bridgeDisplaySlots(displayManager: Displaymanager, bridge: Bridge): DisplaySlotBridge {
  const open = new Map<string, DisplaySlotEvent>();
  displayManager.subscribe(async (stack) => {
    for (const slot of stack) {
      if (open.has(slot.id)) continue;
      const ev: DisplaySlotEvent = {
        slotId: slot.id,
        renderer: slot.renderer,
        input: slot.input,
        createdAt: Date.now(),
        isPermissionRequest: slot.renderer === "permission_request",
      };
      open.set(slot.id, ev);
      bridge.emit({ type: "display_slot_pushed", slot: ev });
    }
    // Slots that left the stack were resolved/rejected — tell clients, or a
    // prompt resolved elsewhere (TUI, timeout) lingers on every other client.
    const live = new Set(stack.map((s) => s.id));
    for (const id of [...open.keys()]) {
      if (!live.has(id)) {
        open.delete(id);
        bridge.emit({ type: "display_slot_resolved", slotId: id });
      }
    }
  });
  return { openSlots: () => [...open.values()] };
}
