import React, { useState, useEffect, useRef, useMemo } from "react";
import { useKeyboard } from "@opentui/react";
import { theme } from "../theme.ts";
import { SlashMenu, SLASH_COMMANDS, SUBAGENT_MENTIONS } from "./slash-menu.tsx";

interface Props {
  busy: boolean;
  onSubmit: (text: string) => void;
  onAbort: () => void;
  onQuit: () => void;
  width: number;
}

const MIN_LINES = 1;
const MAX_LINES = 8;

/**
 * Auto-growing input. Uses OpenTUI's `<textarea>` so multi-line wrapping
 * Just Works — the prior `<input>` would scroll horizontally and hide
 * already-typed text past the visible width.
 *
 * Behavior:
 *   - Enter submits; Shift+Enter inserts a newline (textarea default).
 *   - Box height grows from 1 line to MAX_LINES based on the current
 *     content's wrapped line count, then the textarea internally scrolls.
 *   - After submit we bump `instanceKey` to force a fresh textarea so its
 *     internal buffer resets (the renderable is uncontrolled — there's no
 *     `value` prop; only `initialValue`).
 *   - Slash/@ menu navigation + history live in this component, not the
 *     textarea, so up/down work consistently.
 */
export function InputBar({ busy, onSubmit, onAbort, onQuit, width }: Props) {
  const [value, setValue] = useState("");
  const [menuIndex, setMenuIndex] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  // Bumped after submit / explicit clear to force-remount the textarea so
  // its uncontrolled buffer is reset.
  const [instanceKey, setInstanceKey] = useState(0);
  const submittingRef = useRef(false);

  useEffect(() => {
    setMenuIndex(0);
  }, [value.split(/\s/)[0]]);

  const lastToken = value.split(/\s/).at(-1) ?? "";
  const showingMenu = lastToken.startsWith("/") || lastToken.startsWith("@");

  // Reserve 4 cols of chrome (border + prompt glyph + space + margin) when
  // estimating wrapped lines.
  const innerWidth = Math.max(20, width - 6);
  const visibleLines = useMemo(() => {
    if (!value) return MIN_LINES;
    let lines = 0;
    for (const segment of value.split("\n")) {
      const w = Math.max(1, segment.length);
      lines += Math.max(1, Math.ceil(w / innerWidth));
    }
    return Math.min(MAX_LINES, Math.max(MIN_LINES, lines));
  }, [value, innerWidth]);

  const boxHeight = visibleLines + 2; // +2 for top/bottom border

  useKeyboard((key) => {
    if (submittingRef.current) return;

    // Ctrl+C: abort if busy, quit on empty, otherwise clear input.
    if (key.name === "c" && key.ctrl) {
      if (busy) {
        onAbort();
      } else if (value === "") {
        onQuit();
      } else {
        setValue("");
        setInstanceKey((k) => k + 1);
      }
      return;
    }

    if (showingMenu) {
      const pool = lastToken.startsWith("/") ? SLASH_COMMANDS : SUBAGENT_MENTIONS;
      const matches = pool.filter((c) => c.name.startsWith(lastToken));
      if (key.name === "tab" && matches.length > 0) {
        const chosen = matches[Math.min(menuIndex, matches.length - 1)]!.name;
        const prefix = value.slice(0, value.length - lastToken.length);
        const next = prefix + chosen + " ";
        setValue(next);
        setInstanceKey((k) => k + 1);
        return;
      }
      if (key.name === "up" && matches.length > 0) {
        setMenuIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.name === "down" && matches.length > 0) {
        setMenuIndex((i) => Math.min(matches.length - 1, i + 1));
        return;
      }
    }

    if (key.name === "up" && value === "") {
      if (history.length === 0) return;
      const next = historyIdx === null ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(next);
      setValue(history[next]!);
      setInstanceKey((k) => k + 1);
      return;
    }
    if (key.name === "down" && historyIdx !== null) {
      const next = historyIdx + 1;
      if (next >= history.length) {
        setHistoryIdx(null);
        setValue("");
        setInstanceKey((k) => k + 1);
      } else {
        setHistoryIdx(next);
        setValue(history[next]!);
        setInstanceKey((k) => k + 1);
      }
      return;
    }
  });

  const performSubmit = (text: string) => {
    const t = text.trim();
    if (!t) return;
    submittingRef.current = true;
    setValue("");
    setHistoryIdx(null);
    setInstanceKey((k) => k + 1);
    setHistory((h) => (h.at(-1) === t ? h : [...h, t]).slice(-50));
    if (t === "/quit" || t === "/exit") {
      onQuit();
      return;
    }
    if (t === "/help") {
      onSubmit("/help — list commands and tools available in this session");
    } else {
      onSubmit(t);
    }
    setTimeout(() => {
      submittingRef.current = false;
    }, 0);
  };

  return (
    <box flexDirection="column" width={width}>
      <SlashMenu query={lastToken} selectedIndex={menuIndex} width={width} />
      <box
        flexDirection="row"
        border
        borderColor={busy ? theme.warning : theme.borderActive}
        padding={0}
        paddingX={1}
        height={boxHeight}
        width={width}
        alignItems="flex-start"
      >
        <text fg={busy ? theme.warning : theme.accent}>
          <strong>{busy ? "…" : "›"}</strong>
        </text>
        <text> </text>
        <box flexGrow={1} height={visibleLines}>
          <GlorpTextarea
            key={instanceKey}
            initialValue={value}
            onContentChange={setValue}
            onSubmit={() => performSubmit(value)}
            focused
            wrapText
            placeholder={
              busy
                ? "glorp is working… (ctrl-c to abort)"
                : "ask, command, or /slash · @subagent · shift+enter newline · ctrl-c to quit"
            }
            textColor={theme.text}
            placeholderColor={theme.textDim}
            backgroundColor="transparent"
            focusedBackgroundColor="transparent"
          />
        </box>
      </box>
      <box flexDirection="row" paddingX={1}>
        <text fg={theme.textDim}>
          enter ↩ send · shift+↩ newline · tab ⇥ complete · ↑↓ history · ctrl-c abort/quit
        </text>
      </box>
    </box>
  );
}

/**
 * Typed wrapper around OpenTUI's `<textarea>` intrinsic. Same JSX-
 * intersection hazard as the input wrapper in earlier revisions —
 * OpenTUI's textarea props intersect with React DOM's HTMLTextAreaElement
 * type when the JSX namespace `extends React.JSX.IntrinsicElements`.
 * Containing the cast here keeps the rest of the file in clean types.
 */
interface GlorpTextareaProps {
  initialValue?: string;
  onContentChange?: (value: string) => void;
  onSubmit?: () => void;
  focused?: boolean;
  wrapText?: boolean;
  placeholder?: string;
  textColor?: string;
  placeholderColor?: string;
  backgroundColor?: string;
  focusedBackgroundColor?: string;
}

function GlorpTextarea(props: GlorpTextareaProps): React.ReactElement {
  // onContentChange in OpenTUI receives a ContentChangeEvent — we adapt
  // it to a `(value: string) => void` for ergonomic consumption.
  const adapter = props.onContentChange
    ? (event: { content?: string } | string) => {
        const v = typeof event === "string" ? event : (event.content ?? "");
        props.onContentChange!(v);
      }
    : undefined;
  return React.createElement(
    "textarea",
    {
      ...props,
      onContentChange: adapter,
    } as unknown as React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  );
}
