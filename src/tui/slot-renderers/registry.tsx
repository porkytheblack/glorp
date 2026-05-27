import React from "react";
import type { DisplaySlotEvent } from "../../shared/events.ts";

/**
 * Props passed to every slot renderer. `slot.input` is the value the agent
 * (or executor) supplied. `onResolve` unblocks a pushAndWait promise on the
 * server; `onReject` rejects it.
 */
export interface SlotRendererProps {
  slot: DisplaySlotEvent;
  onResolve: (value: unknown) => void;
  onReject: (reason?: string) => void;
}

export type SlotRenderer = React.ComponentType<SlotRendererProps>;

/**
 * Mutable map from renderer-name to React component. Built-in renderers are
 * registered at module-load by `index.tsx`; consumers can add more at runtime.
 */
export const SLOT_RENDERERS = new Map<string, SlotRenderer>();

export function registerSlotRenderer(name: string, renderer: SlotRenderer): void {
  SLOT_RENDERERS.set(name, renderer);
}

export function getSlotRenderer(name: string): SlotRenderer | undefined {
  return SLOT_RENDERERS.get(name);
}
