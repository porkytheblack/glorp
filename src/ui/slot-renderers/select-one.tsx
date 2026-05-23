import React, { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { theme } from "../theme.ts";
import type { SlotRendererProps } from "./registry.tsx";

/**
 * `select_one` slot — pick one option from a list. Resolves with the
 * selected `value` (or `label` if no value provided), or with a custom
 * free-form answer typed by the user. Reject with esc.
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
  const [custom, setCustom] = useState("");
  const clamped = Math.min(cursor, Math.max(0, options.length - 1));

  useKeyboard((key) => {
    if (key.name === "escape") return onReject("cancelled");
    if (key.name === "backspace") {
      setCustom((current) => current.slice(0, -1));
      return;
    }
    if (key.ctrl && key.name === "u") {
      setCustom("");
      return;
    }
    if (key.name === "up") setCursor((c) => Math.max(0, c - 1));
    else if (key.name === "down") setCursor((c) => Math.min(options.length - 1, c + 1));
    else if (key.name === "return") {
      const customAnswer = custom.trim();
      if (customAnswer) return onResolve(customAnswer);
      const opt = options[clamped];
      if (opt) onResolve(opt.value ?? opt.label);
    } else {
      const typed = printableKeyText(key);
      if (typed !== undefined) setCustom((current) => `${current}${typed}`);
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
        <text fg={theme.textDim}>↑↓ pick · type custom · enter submit · esc cancel</text>
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
        <box
          marginTop={1}
          border
          borderColor={custom.trim() ? theme.accent : theme.border}
          paddingX={1}
          minHeight={3}
          flexDirection="row"
        >
          <text fg={theme.accent}>
            <strong>›</strong>
          </text>
          <text> </text>
          <text fg={custom ? theme.text : theme.textMuted}>
            {custom || "free-form answer"}
          </text>
        </box>
      </box>
    </box>
  );
}

function printableKeyText(key: { name?: string; sequence?: string; ctrl?: boolean; meta?: boolean; super?: boolean }) {
  if (key.ctrl || key.meta || key.super) return undefined;
  if (key.name === "space") return " ";
  if (!key.sequence || key.sequence.length !== 1) return undefined;
  const code = key.sequence.charCodeAt(0);
  if (code < 32 || code === 127) return undefined;
  return key.sequence;
}
