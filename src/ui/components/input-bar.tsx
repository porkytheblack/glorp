import React, { useState, useEffect, useRef, useMemo } from "react";
import { useKeyboard } from "@opentui/react";
import { theme } from "../theme.ts";
import { SlashMenu, SLASH_COMMANDS, SUBAGENT_MENTIONS } from "./slash-menu.tsx";
import type { SlashCommand } from "./slash-menu.tsx";

interface Props {
  busy: boolean;
  onSubmit: (text: string) => void;
  onAbort: () => void;
  onQuit: () => void;
  width: number;
  /** Dynamic catalogue from the agent; falls back to the hardcoded list. */
  slashCommands?: SlashCommand[];
  subagentMentions?: SlashCommand[];
}

const MIN_LINES = 1;
const MAX_LINES = 8;

/**
 * Auto-growing chat input. Uses OpenTUI's `<textarea>` for multi-line wrap
 * (the prior `<input>` scrolled horizontally and hid already-typed text).
 *
 *   - Enter submits; Shift+Enter inserts a newline.
 *   - Box height grows from MIN_LINES to MAX_LINES based on wrapped
 *     content; past MAX_LINES the textarea scrolls internally.
 *   - On submit we clear the buffer via `editBuffer.setText("")` on the
 *     underlying renderable (key-bump remount alone wasn't reliably
 *     clearing the buffer under the OpenTUI reconciler).
 *   - Slash/@ menu navigation + history live here, not in the textarea,
 *     so up/down + tab behaviour stays consistent.
 *   - While the agent is busy, the input shows a clear "thinking" state
 *     and explicit "ctrl-c to interrupt" messaging. Submissions are
 *     blocked until the agent finishes (avoids the user typing into the
 *     void and wondering if their message went through).
 */
export function InputBar({
  busy,
  onSubmit,
  onAbort,
  onQuit,
  width,
  slashCommands = SLASH_COMMANDS,
  subagentMentions = SUBAGENT_MENTIONS,
}: Props) {
  const [value, setValue] = useState("");
  const [menuIndex, setMenuIndex] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  // Ref to the underlying TextareaRenderable so we can call setText("")
  // to actually clear the buffer after submit.
  const textareaRef = useRef<{ editBuffer?: { setText: (s: string) => void } } | null>(null);
  // Re-mount counter — bumped on history scrub so the textarea picks up
  // the new initialValue. After submit we clear in-place via the ref.
  const [instanceKey, setInstanceKey] = useState(0);

  useEffect(() => {
    setMenuIndex(0);
  }, [value.split(/\s/)[0]]);

  const lastToken = value.split(/\s/).at(-1) ?? "";
  const showingMenu = lastToken.startsWith("/") || lastToken.startsWith("@");

  // Reserve 6 cols of chrome (border + prompt glyph + spaces) when
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

  /** Clear the textarea buffer via the renderable's ref. */
  const clearBuffer = () => {
    try {
      textareaRef.current?.editBuffer?.setText("");
    } catch {
      /* harmless — fall through to remount */
    }
    setValue("");
  };

  /** Replace the textarea buffer with `text` and update React state. */
  const setBuffer = (text: string) => {
    try {
      textareaRef.current?.editBuffer?.setText(text);
    } catch {}
    setValue(text);
  };

  useKeyboard((key) => {
    // Ctrl+C: abort the agent if it's working; quit on empty input;
    // otherwise clear the current draft. Always runs — even when busy —
    // so the user can interrupt at any time.
    if (key.name === "c" && key.ctrl) {
      if (busy) {
        onAbort();
      } else if (value === "") {
        onQuit();
      } else {
        clearBuffer();
      }
      return;
    }

    if (showingMenu) {
      const pool = lastToken.startsWith("/") ? slashCommands : subagentMentions;
      const matches = pool.filter((c) => c.name.startsWith(lastToken));
      if (key.name === "tab" && matches.length > 0) {
        const chosen = matches[Math.min(menuIndex, matches.length - 1)]!.name;
        const prefix = value.slice(0, value.length - lastToken.length);
        const next = prefix + chosen + " ";
        setBuffer(next);
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
      setBuffer(history[next]!);
      setInstanceKey((k) => k + 1);
      return;
    }
    if (key.name === "down" && historyIdx !== null) {
      const next = historyIdx + 1;
      if (next >= history.length) {
        setHistoryIdx(null);
        clearBuffer();
        setInstanceKey((k) => k + 1);
      } else {
        setHistoryIdx(next);
        setBuffer(history[next]!);
        setInstanceKey((k) => k + 1);
      }
      return;
    }
  });

  const performSubmit = (text: string) => {
    const t = text.trim();
    if (!t) return;
    // Block new submissions while the agent is working — the user should
    // either wait or hit ctrl-c first. Otherwise they get confused about
    // whether their message landed.
    if (busy) return;
    // Clear the buffer FIRST so the user sees the input empty on next
    // render even if onSubmit is synchronous.
    clearBuffer();
    setHistoryIdx(null);
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
  };

  // Border + placeholder vocabulary changes when busy so the loading
  // state is obvious. The transcript also shows a "thinking" row.
  const borderColor = busy ? theme.warning : theme.borderActive;
  const promptGlyph = busy ? "…" : "›";
  const placeholder = busy
    ? "agent is thinking · press ctrl-c to interrupt"
    : "ask, command, or /slash · @subagent · shift+enter newline · ctrl-c to quit";

  return (
    <box flexDirection="column" width={width}>
      <SlashMenu
        query={lastToken}
        selectedIndex={menuIndex}
        width={width}
        slashCommands={slashCommands}
        subagentMentions={subagentMentions}
      />
      <box
        flexDirection="row"
        border
        borderColor={borderColor}
        padding={0}
        paddingX={1}
        height={boxHeight}
        width={width}
        alignItems="flex-start"
      >
        <text fg={busy ? theme.warning : theme.accent}>
          <strong>{promptGlyph}</strong>
        </text>
        <text> </text>
        <box flexGrow={1} height={visibleLines}>
          <GlorpTextarea
            key={instanceKey}
            innerRef={textareaRef}
            initialValue={value}
            onContentChange={setValue}
            onSubmit={() => performSubmit(value)}
            focused
            wrapMode="word"
            placeholder={placeholder}
            textColor={theme.text}
            placeholderColor={busy ? theme.warning : theme.textDim}
            backgroundColor="transparent"
            focusedBackgroundColor="transparent"
          />
        </box>
      </box>
      <box flexDirection="row" paddingX={1}>
        <text fg={theme.textDim}>
          {busy
            ? "ctrl-c interrupts · submissions blocked until done"
            : "enter ↩ send · shift+↩ newline · tab ⇥ complete · ↑↓ history · ctrl-c abort/quit"}
        </text>
      </box>
    </box>
  );
}

interface GlorpTextareaProps {
  initialValue?: string;
  onContentChange?: (value: string) => void;
  onSubmit?: () => void;
  focused?: boolean;
  /** Wrap long lines. "word" wraps at word boundaries, "char" at any char. */
  wrapMode?: "none" | "char" | "word";
  placeholder?: string;
  textColor?: string;
  placeholderColor?: string;
  backgroundColor?: string;
  focusedBackgroundColor?: string;
  /** Ref to the underlying TextareaRenderable so callers can clear it. */
  innerRef?: React.MutableRefObject<{ editBuffer?: { setText: (s: string) => void } } | null>;
}

function GlorpTextarea(props: GlorpTextareaProps): React.ReactElement {
  const { innerRef, onContentChange, ...rest } = props;
  const adapter = onContentChange
    ? (event: { content?: string } | string) => {
        const v = typeof event === "string" ? event : (event.content ?? "");
        onContentChange(v);
      }
    : undefined;
  return React.createElement("textarea", {
    ...rest,
    onContentChange: adapter,
    ref: innerRef,
  } as unknown as React.TextareaHTMLAttributes<HTMLTextAreaElement>);
}
