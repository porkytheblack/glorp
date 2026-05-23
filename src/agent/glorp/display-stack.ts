import type { DisplayManagerAdapter } from "glove-core/display-manager";
import type { Bridge } from "../../shared/bridge.ts";

/**
 * Bridge every display-stack push (permission requests, modals, custom
 * agent UI) into a bridge event so the React TUI can render it. Glove's
 * executor pushes `permission_request` slots automatically; the agent or
 * any tool can push other renderers via `pushAndWait` to collect input.
 */
export function wireDisplayStack(displayManager: DisplayManagerAdapter, bridge: Bridge): void {
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
