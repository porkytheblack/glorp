import React, { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { theme } from "../theme.ts";
import type { SlotRendererProps } from "./registry.tsx";

/**
 * `select_one` slot — pick one option from a list. Resolves with the
 * selected `value` (or `label` if no value provided). Reject with esc.
 *
 * Input: { question?: string, options: Array<{ label: string, value?: string, description?: string }> }
 */
export function SelectOneSlot({ slot, onResolve, onReject }: SlotRendererProps) {
  const { width, height } = useTerminalDimensions();
  const input = slot.input as {
    question?: string;
    options?: Array<{ label: string; value?: string; description?: string }>;
  };
  const options = input.options ?? [];
  const [cursor, setCursor] = useState(0);
  const clamped = Math.min(cursor, Math.max(0, options.length - 1));

  useKeyboard((key) => {
    if (key.name === "escape") return onReject("cancelled");
    if (key.name === "up" || key.name === "k") setCursor((c) => Math.max(0, c - 1));
    else if (key.name === "down" || key.name === "j")
      setCursor((c) => Math.min(options.length - 1, c + 1));
    else if (key.name === "return") {
      const opt = options[clamped];
      if (opt) onResolve(opt.value ?? opt.label);
    }
  });

  const panelW = Math.min(86, Math.max(50, width - 8));
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
        borderColor={theme.borderActive}
        backgroundColor={theme.bgPanel}
        padding={1}
      >
        <text fg={theme.accent}>
          <strong>{input.question ?? "choose one"}</strong>
        </text>
        <text fg={theme.textDim}>↑↓ pick · enter select · esc cancel</text>
        <box marginTop={1} flexDirection="column">
          {options.length === 0 && <text fg={theme.textMuted}>(no options provided)</text>}
          {options.map((o, i) => {
            const highlighted = i === clamped;
            const fg = highlighted ? theme.bg : theme.text;
            const bg = highlighted ? theme.accent : "transparent";
            return (
              <box key={i} flexDirection="column">
                <text fg={fg} bg={bg}>{` ${highlighted ? "▸" : " "} ${o.label} `}</text>
                {highlighted && o.description && (
                  <text fg={theme.textMuted}>{`   ${o.description}`}</text>
                )}
              </box>
            );
          })}
        </box>
      </box>
    </box>
  );
}
