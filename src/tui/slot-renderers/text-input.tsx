import React, { useCallback, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { theme } from "../theme.ts";
import { OverlayHost, OverlayPanel } from "../overlay-host.tsx";
import type { SlotRendererProps } from "./registry.tsx";

interface TextareaHandle {
  plainText?: string;
  editBuffer?: { getText?: () => string; setText?: (t: string) => void };
}

/**
 * `text_input` slot — collect a free-form string. Enter submits, Esc cancels.
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

  const readText = useCallback(() => {
    return inputRef.current?.plainText ?? inputRef.current?.editBuffer?.getText?.() ?? value;
  }, [value]);

  const panelW = Math.min(80, Math.max(46, width - 8));
  const maxLines = 8;

  const bindings = [
    { name: "return", action: "submit" },
    { name: "kpenter", action: "submit" },
    { name: "linefeed", action: "newline" },
    { name: "return", shift: true, action: "newline" },
    { name: "kpenter", shift: true, action: "newline" },
  ];

  const syncText = useCallback(() => {
    const t = inputRef.current?.plainText ?? inputRef.current?.editBuffer?.getText?.();
    if (typeof t === "string") setValue(t);
  }, []);

  return (
    <OverlayHost width={width} height={height}>
      <OverlayPanel
        title={input.question ?? "input"}
        hint="enter submit · shift+enter newline · esc cancel"
        width={panelW}
      >
        <box marginTop={1} border borderColor={theme.borderActive} paddingX={1}
          minHeight={3} maxHeight={maxLines + 2}>
          <text fg={theme.accent}><strong>›</strong></text>
          <text> </text>
          <textarea
            initialValue={value}
            onContentChange={syncText}
            onSubmit={() => onResolve(readText())}
            focused
            minHeight={1}
            maxHeight={maxLines}
            wrapMode="word"
            keyBindings={bindings as any}
            placeholder={input.placeholder ?? ""}
            textColor={theme.text}
            placeholderColor={theme.textDim}
            backgroundColor="transparent"
            focusedBackgroundColor="transparent"
            ref={(node: TextareaHandle | null) => { inputRef.current = node; }}
          />
        </box>
      </OverlayPanel>
    </OverlayHost>
  );
}
