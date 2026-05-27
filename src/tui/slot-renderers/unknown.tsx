import React from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { theme } from "../theme.ts";
import { OverlayHost, OverlayPanel } from "../overlay-host.tsx";
import type { SlotRendererProps } from "./registry.tsx";

/**
 * Fallback renderer for slots whose `renderer` name isn't in the registry.
 * Shows the raw input so the user isn't stuck; pressing 'a' allows, 'd'/esc denies.
 */
export function UnknownSlot({ slot, onResolve, onReject }: SlotRendererProps) {
  const { width, height } = useTerminalDimensions();

  useKeyboard((key) => {
    if (key.name === "a" || key.name === "return") onResolve(true);
    else if (key.name === "d" || key.name === "escape") onReject("cancelled");
  });

  const panelW = Math.min(80, Math.max(46, width - 8));
  let pretty: string;
  try { pretty = JSON.stringify(slot.input, null, 2); }
  catch { pretty = String(slot.input); }
  const lines = pretty.split("\n").slice(0, 14);

  return (
    <OverlayHost width={width} height={height}>
      <OverlayPanel
        title="agent is waiting on a custom modal"
        titleColor={theme.warning}
        borderColor={theme.warning}
        width={panelW}
      >
        <text fg={theme.textMuted}>renderer: {slot.renderer} · no UI registered</text>
        <box marginTop={1} flexDirection="column">
          {lines.map((l, i) => (
            <text key={i} fg={theme.toolOutput}>{`  ${l.slice(0, panelW - 6)}`}</text>
          ))}
        </box>
        <box marginTop={1}>
          <text fg={theme.textMuted}>
            <span fg={theme.success}>a/enter</span> resolve true{" · "}
            <span fg={theme.error}>d/esc</span> reject
          </text>
        </box>
      </OverlayPanel>
    </OverlayHost>
  );
}
