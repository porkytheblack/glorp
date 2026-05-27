import React, { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { theme } from "../theme.ts";
import { OverlayHost, OverlayPanel } from "../overlay-host.tsx";
import type { SlotRendererProps } from "./registry.tsx";

/**
 * `select_one` slot — pick one option from a list, or type a custom answer.
 * Input: { question?: string, options: Array<{ label, value?, description? }> }
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
    if (key.name === "backspace") { setCustom((c) => c.slice(0, -1)); return; }
    if (key.ctrl && key.name === "u") { setCustom(""); return; }
    if (key.name === "up") setCursor((c) => Math.max(0, c - 1));
    else if (key.name === "down") setCursor((c) => Math.min(options.length - 1, c + 1));
    else if (key.name === "return") {
      const trimmed = custom.trim();
      if (trimmed) return onResolve(trimmed);
      const opt = options[clamped];
      if (opt) onResolve(opt.value ?? opt.label);
    } else {
      const ch = printable(key);
      if (ch !== undefined) setCustom((c) => c + ch);
    }
  });

  const panelW = Math.min(80, Math.max(46, width - 8));

  return (
    <OverlayHost width={width} height={height}>
      <OverlayPanel
        title={input.question ?? "choose one"}
        hint="up/down pick · type custom · enter submit · esc cancel"
        width={panelW}
      >
        <box marginTop={1} flexDirection="column">
          {options.length === 0 && <text fg={theme.textMuted}>(no options provided)</text>}
          {options.map((o, i) => {
            const hl = i === clamped;
            const fg = hl ? theme.bg : theme.text;
            const bg = hl ? theme.accent : "transparent";
            return (
              <box key={i} flexDirection="column">
                <text fg={fg} bg={bg}>{` ${hl ? "▸" : " "} ${o.label} `}</text>
                {hl && o.description && <text fg={theme.textMuted}>{`   ${o.description}`}</text>}
              </box>
            );
          })}
        </box>
        <box marginTop={1} border borderColor={custom.trim() ? theme.accent : theme.border}
          paddingX={1} minHeight={3} flexDirection="row">
          <text fg={theme.accent}><strong>›</strong></text>
          <text> </text>
          <text fg={custom ? theme.text : theme.textMuted}>{custom || "free-form answer"}</text>
        </box>
      </OverlayPanel>
    </OverlayHost>
  );
}

function printable(key: { name?: string; sequence?: string; ctrl?: boolean; meta?: boolean; super?: boolean }) {
  if (key.ctrl || key.meta || key.super) return undefined;
  if (key.name === "space") return " ";
  if (!key.sequence || key.sequence.length !== 1) return undefined;
  const code = key.sequence.charCodeAt(0);
  if (code < 32 || code === 127) return undefined;
  return key.sequence;
}
