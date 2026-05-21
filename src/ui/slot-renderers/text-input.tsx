import React, { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { theme } from "../theme.ts";
import type { SlotRendererProps } from "./registry.tsx";

/**
 * `text_input` slot — collect a free-form string from the user. Resolves
 * with the entered string. Reject with esc.
 *
 * Input: { question?: string, placeholder?: string, initial?: string }
 */
export function TextInputSlot({ slot, onResolve, onReject }: SlotRendererProps) {
  const { width, height } = useTerminalDimensions();
  const input = slot.input as { question?: string; placeholder?: string; initial?: string };
  const [value, setValue] = useState(input.initial ?? "");

  useKeyboard((key) => {
    if (key.name === "escape") return onReject("cancelled");
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
          <strong>{input.question ?? "input"}</strong>
        </text>
        <text fg={theme.textDim}>enter ↩ submit · esc cancel</text>
        <box
          marginTop={1}
          border
          borderColor={theme.borderActive}
          padding={0}
          paddingX={1}
          height={3}
        >
          <text fg={theme.accent}>
            <strong>›</strong>
          </text>
          <text> </text>
          <SlotInputControl
            value={value}
            onChange={setValue}
            onSubmit={() => onResolve(value)}
            placeholder={input.placeholder ?? ""}
          />
        </box>
      </box>
    </box>
  );
}

interface SlotInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
}

// Same Enter-submits / Shift+Enter-newlines swap as the main input bar.
// OpenTUI's defaults are the opposite, which trips chat-shaped UX.
const SUBMIT_ON_ENTER_BINDINGS = [
  { name: "return", action: "submit" },
  { name: "kpenter", action: "submit" },
  { name: "linefeed", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "kpenter", shift: true, action: "newline" },
];

function SlotInputControl(props: SlotInputProps): React.ReactElement {
  const adapter = (event: { content?: string } | string) => {
    const v = typeof event === "string" ? event : (event.content ?? "");
    props.onChange(v);
  };
  return React.createElement("textarea", {
    initialValue: props.value,
    onContentChange: adapter,
    onSubmit: () => props.onSubmit(),
    focused: true,
    wrapMode: "word",
    keyBindings: SUBMIT_ON_ENTER_BINDINGS,
    placeholder: props.placeholder,
    textColor: theme.text,
    placeholderColor: theme.textDim,
    backgroundColor: "transparent",
    focusedBackgroundColor: "transparent",
  } as unknown as React.TextareaHTMLAttributes<HTMLTextAreaElement>);
}
