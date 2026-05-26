/**
 * Full-screen host for a display slot (permission request, confirm, etc.).
 * Extracted from app.tsx to keep the main layout file under the line ceiling.
 */
import React, { useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import type { GlorpHandle } from "../agent/glorp.ts";
import type { DisplaySlotEvent } from "../shared/events.ts";
import type { SlotRenderer } from "./slot-renderers/registry.tsx";

export function isAbortKey(key: { name?: string; sequence?: string; ctrl?: boolean }): boolean {
  return key.sequence === "\u0003" || (key.ctrl === true && key.name === "c");
}

export function DisplaySlotHost({
  glorp,
  slot,
  Renderer,
}: {
  glorp: GlorpHandle;
  slot: DisplaySlotEvent;
  Renderer: SlotRenderer;
}) {
  const [closed, setClosed] = useState(false);
  const close = useCallback((fn: () => void) => {
    setClosed((wasClosed) => {
      if (wasClosed) return wasClosed;
      fn();
      return true;
    });
  }, []);

  useKeyboard((key) => {
    if (closed) return;
    if (isAbortKey(key)) {
      close(() => {
        glorp.rejectSlot(slot.slotId, "cancelled");
        glorp.abort();
      });
      return;
    }
    if (key.name === "escape") {
      close(() => glorp.rejectSlot(slot.slotId, "cancelled"));
    }
  });

  return React.createElement(Renderer, {
    slot,
    onResolve: (value: unknown) => close(() => glorp.resolveSlot(slot.slotId, value)),
    onReject: (reason?: string) => close(() => glorp.rejectSlot(slot.slotId, reason ?? "cancelled")),
  });
}
