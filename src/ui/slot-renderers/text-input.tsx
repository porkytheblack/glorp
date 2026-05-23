import React, { useCallback, useRef, useState } from "react";
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
  const inputRef = useRef<TextareaHandle | null>(null);

  useKeyboard((key) => {
    if (key.name === "escape") return onReject("cancelled");
  });

  const panelW = Math.min(86, Math.max(50, width - 8));
  const maxLines = 8;
  const readInputText = () => inputRef.current?.plainText ?? inputRef.current?.editBuffer?.getText?.() ?? value;

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
        <text fg={theme.textDim}>enter ↩ submit · shift+↩ newline · esc cancel</text>
        <box
          marginTop={1}
          border
          borderColor={theme.borderActive}
          padding={0}
          paddingX={1}
          minHeight={3}
          maxHeight={maxLines + 2}
        >
          <text fg={theme.accent}>
            <strong>›</strong>
          </text>
          <text> </text>
          <SlotInputControl
            value={value}
            innerRef={inputRef}
            onChange={setValue}
            onSubmit={() => onResolve(readInputText())}
            placeholder={input.placeholder ?? ""}
            maxHeight={maxLines}
          />
        </box>
      </box>
    </box>
  );
}

interface SlotInputProps {
  value: string;
  innerRef?: React.MutableRefObject<TextareaHandle | null>;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  maxHeight: number;
}

interface TextareaHandle {
  plainText?: string;
  editBuffer?: {
    getText?: () => string;
  };
}

// Same Enter-submits / Shift+Enter-newlines swap as the main input bar.
// OpenTUI's defaults are the opposite, which trips chat-shaped UX.
const SUBMIT_ON_ENTER_BINDINGS = [
  { name: "return", action: "submit" },
  { name: "kpenter", action: "submit" },
  { name: "linefeed", action: "newline" },
  { name: "return", shift: true, action: "newline" },
  { name: "kpenter", shift: true, action: "newline" },
  { name: "linefeed", shift: true, action: "newline" },
];

function SlotInputControl(props: SlotInputProps): React.ReactElement {
  const localRef = useRef<TextareaHandle | null>(null);
  const lastTextRef = useRef(props.value);
  const setRenderableRef = useCallback((node: TextareaHandle | null) => {
    localRef.current = node;
    if (props.innerRef) props.innerRef.current = node;
  }, [props.innerRef]);
  const readLocalText = () => {
    const next = localRef.current?.plainText ?? localRef.current?.editBuffer?.getText?.();
    if (typeof next === "string") lastTextRef.current = next;
    return lastTextRef.current;
  };
  const adapter = (event: { content?: string } | string) => {
    if (typeof event === "string") {
      props.onChange(event);
      return;
    }
    if (typeof event.content === "string") {
      props.onChange(event.content);
      return;
    }
    const sync = () => props.onChange(readLocalText());
    sync();
    queueMicrotask(sync);
    setTimeout(sync, 0);
  };
  return React.createElement("textarea", {
    initialValue: props.value,
    onContentChange: adapter,
    onSubmit: () => props.onSubmit(),
    focused: true,
    minHeight: 1,
    maxHeight: props.maxHeight,
    wrapMode: "word",
    keyBindings: SUBMIT_ON_ENTER_BINDINGS,
    placeholder: props.placeholder,
    textColor: theme.text,
    placeholderColor: theme.textDim,
    backgroundColor: "transparent",
    focusedBackgroundColor: "transparent",
    ref: setRenderableRef,
  } as unknown as React.TextareaHTMLAttributes<HTMLTextAreaElement>);
}
