import React from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { theme } from "../theme.ts";
import { OverlayHost, OverlayPanel } from "../overlay-host.tsx";
import type { SlotRendererProps } from "./registry.tsx";

/**
 * `confirm` slot: { message: string, yesLabel?: string, noLabel?: string, danger?: boolean }
 * Resolves with true (allow) or false (deny). Esc = cancel.
 */
export function ConfirmSlot({ slot, onResolve, onReject }: SlotRendererProps) {
  const { width, height } = useTerminalDimensions();
  const input = slot.input as {
    message?: string; yesLabel?: string; noLabel?: string; danger?: boolean;
  };

  useKeyboard((key) => {
    if (key.name === "y" || key.name === "return") onResolve(true);
    else if (key.name === "n") onResolve(false);
    else if (key.name === "escape") onReject("cancelled");
  });

  const accent = input.danger ? theme.error : theme.warning;
  const panelW = Math.min(72, Math.max(46, width - 8));

  return (
    <OverlayHost width={width} height={height}>
      <OverlayPanel
        title={input.danger ? "are you sure?" : "confirm"}
        titleColor={accent}
        borderColor={accent}
        width={panelW}
      >
        <box marginTop={1}>
          <text fg={theme.text}>{input.message ?? "Continue?"}</text>
        </box>
        <box marginTop={1}>
          <text fg={theme.textMuted}>
            <span fg={theme.success}>y/enter</span> {input.yesLabel ?? "yes"}{" · "}
            <span fg={theme.error}>n</span> {input.noLabel ?? "no"}{" · "}
            <span fg={theme.error}>esc</span> cancel
          </text>
        </box>
      </OverlayPanel>
    </OverlayHost>
  );
}
