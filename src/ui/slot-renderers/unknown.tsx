import React from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { theme } from "../theme.ts";
import type { SlotRendererProps } from "./registry.tsx";

/**
 * Fallback renderer for slots whose `renderer` name isn't in the registry.
 * Shows the raw input so the user isn't left staring at a blank screen;
 * pressing 'a' allows (resolves with `true`), 'd' / esc denies.
 */
export function UnknownSlot({ slot, onResolve, onReject }: SlotRendererProps) {
  const { width, height } = useTerminalDimensions();
  useKeyboard((key) => {
    if (key.name === "a" || key.name === "return") onResolve(true);
    else if (key.name === "d" || key.name === "escape") onReject("cancelled");
  });

  const panelW = Math.min(86, Math.max(50, width - 8));
  let pretty: string;
  try {
    pretty = JSON.stringify(slot.input, null, 2);
  } catch {
    pretty = String(slot.input);
  }
  const lines = pretty.split("\n").slice(0, 14);
  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={theme.bg}
      justifyContent="center"
      alignItems="center"
    >
      <box
        flexDirection="column"
        width={panelW}
        border
        borderStyle="rounded"
        borderColor={theme.warning}
        backgroundColor={theme.bgPanel}
        padding={1}
      >
        <text fg={theme.warning}>
          <strong>agent is waiting on a custom modal</strong>
        </text>
        <text fg={theme.textMuted}>renderer: {slot.renderer} · no UI registered for this name</text>
        <box marginTop={1} flexDirection="column">
          {lines.map((l, i) => (
            <text key={i} fg={theme.toolOutput}>{`  ${l.slice(0, panelW - 6)}`}</text>
          ))}
        </box>
        <box marginTop={1}>
          <text fg={theme.textMuted}>
            <span fg={theme.success}>a/enter</span> resolve true ·{" "}
            <span fg={theme.error}>d/esc</span> reject
          </text>
        </box>
      </box>
    </box>
  );
}
