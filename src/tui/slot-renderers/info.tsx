import React from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { theme } from "../theme.ts";
import { OverlayHost, OverlayPanel } from "../overlay-host.tsx";
import type { SlotRendererProps } from "./registry.tsx";

/**
 * `info` slot — non-blocking display card. Press any key to dismiss.
 * Input: { title?: string, message: string, severity?: "info"|"success"|"warning"|"error" }
 */
export function InfoSlot({ slot, onResolve }: SlotRendererProps) {
  const { width, height } = useTerminalDimensions();
  const input = slot.input as {
    title?: string; message?: string;
    severity?: "info" | "success" | "warning" | "error";
  };

  useKeyboard((key) => {
    if (key.name === "return" || key.name === "escape" || key.name === "space") {
      onResolve(true);
    }
  });

  const accent = input.severity === "success" ? theme.success
    : input.severity === "warning" ? theme.warning
    : input.severity === "error" ? theme.error
    : theme.borderActive;
  const panelW = Math.min(80, Math.max(46, width - 8));
  const lines = (input.message ?? "").split("\n").slice(0, 20);

  return (
    <OverlayHost width={width} height={height}>
      <OverlayPanel
        title={input.title ?? "info"}
        titleColor={accent}
        borderColor={accent}
        width={panelW}
      >
        <box marginTop={1} flexDirection="column">
          {lines.map((l, i) => (
            <text key={i} fg={theme.text}>{l || " "}</text>
          ))}
        </box>
        <box marginTop={1}>
          <text fg={theme.textMuted}>enter / esc / space to dismiss</text>
        </box>
      </OverlayPanel>
    </OverlayHost>
  );
}
