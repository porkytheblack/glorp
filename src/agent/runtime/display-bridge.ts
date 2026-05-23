import type { Displaymanager } from "glove-core/display-manager";
import type { BridgeEvent, BridgeListener } from "../../shared/events.ts";

interface Bridge {
  emit(event: BridgeEvent): void;
  subscribe(listener: BridgeListener): () => void;
}

export function bridgeDisplaySlots(displayManager: Displaymanager, bridge: Bridge): void {
  const seenSlots = new Set<string>();
  displayManager.subscribe(async (stack) => {
    for (const slot of stack) {
      if (seenSlots.has(slot.id)) continue;
      seenSlots.add(slot.id);
      bridge.emit({
        type: "display_slot_pushed",
        slot: {
          slotId: slot.id,
          renderer: slot.renderer,
          input: slot.input,
          createdAt: Date.now(),
          isPermissionRequest: slot.renderer === "permission_request",
        },
      });
    }
    const live = new Set(stack.map((s) => s.id));
    for (const id of seenSlots) if (!live.has(id)) seenSlots.delete(id);
  });
}
