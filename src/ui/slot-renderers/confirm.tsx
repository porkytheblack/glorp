import React from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { theme } from "../theme.ts";
import type { SlotRendererProps } from "./registry.tsx";

/**
 * `confirm` slot input shape:
 *   { message: string, yesLabel?: string, noLabel?: string, danger?: boolean }
 *
 * Resolves with `true` (allow) or `false` (deny). Keys: y/return = true,
 * n = false, esc = cancel.
 */
export function ConfirmSlot({ slot, onResolve, onReject }: SlotRendererProps) {
  const { width, height } = useTerminalDimensions();
  const input = slot.input as {
    message?: string;
    yesLabel?: string;
    noLabel?: string;
    danger?: boolean;
  };
  useKeyboard((key) => {
    if (key.name === "y" || key.name === "return") onResolve(true);
    else if (key.name === "n") onResolve(false);
    else if (key.name === "escape") onReject("cancelled");
  });

  const accent = input.danger ? theme.error : theme.warning;
  const panelW = Math.min(80, Math.max(50, width - 8));
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
        borderColor={accent}
        backgroundColor={theme.bgPanel}
        padding={1}
      >
        <text fg={accent}>
          <strong>{input.danger ? "are you sure?" : "confirm"}</strong>
        </text>
        <box marginTop={1}>
          <text fg={theme.text}>{input.message ?? "Continue?"}</text>
        </box>
        <box marginTop={1}>
          <text fg={theme.textMuted}>
            <span fg={theme.success}>y/enter</span> {input.yesLabel ?? "yes"} ·{" "}
            <span fg={theme.error}>n</span> {input.noLabel ?? "no"} ·{" "}
            <span fg={theme.error}>esc</span> cancel
          </text>
        </box>
      </box>
    </box>
  );
}
