import type React from "react";
import type { DisplaySlotEvent } from "../../shared/events.ts";

/**
 * Props passed to every slot renderer. `slot.input` is the value the agent
 * (or executor) supplied via `displayManager.pushAndWait({ renderer, input })`.
 * `onResolve` unblocks a pushAndWait promise; `onReject` rejects it.
 */
export interface SlotRendererProps {
  slot: DisplaySlotEvent;
  onResolve: (value: unknown) => void;
  onReject: (reason?: string) => void;
}

export type SlotRenderer = React.ComponentType<SlotRendererProps>;

/**
 * Mutable map from renderer-name → React component. Built-in renderers are
 * registered at module-load by `register-builtins.ts`; consumers (tools,
 * subagents) can add more at runtime.
 */
export const SLOT_RENDERERS = new Map<string, SlotRenderer>();

export function registerSlotRenderer(name: string, renderer: SlotRenderer): void {
  SLOT_RENDERERS.set(name, renderer);
}

export function getSlotRenderer(name: string): SlotRenderer | undefined {
  return SLOT_RENDERERS.get(name);
}
