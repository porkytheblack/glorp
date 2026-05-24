import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import { theme } from "../theme.ts";
import { SlashMenu, SLASH_COMMANDS, SKILL_HINTS, SLASH_MENU_VISIBLE_ROWS, SUBAGENT_MENTIONS } from "./slash-menu.tsx";
import type { SlashCommand } from "./slash-menu.tsx";

interface Props {
  busy: boolean;
  onSubmit: (text: string) => void;
  onAbort: () => void;
  onQuit: () => void;
  width: number;
  /** Dynamic catalogue from the agent; falls back to the hardcoded list. */
  slashCommands?: SlashCommand[];
  skillHints?: SlashCommand[];
  subagentMentions?: SlashCommand[];
  /**
   * Visual variant:
   *   - "default" — pinned at the bottom of the chat layout with a
   *     verbose hint line ("enter ↩ send · shift+↩ newline · …").
   *   - "hero"    — centred on the empty-state landing. Rounded border,
   *     coloured left accent, model + hints rendered INSIDE the box.
   */
  variant?: "default" | "hero";
  /** Human-readable model label rendered in the hero variant footer. */
  modelLabel?: string;
  /** Reports the current rendered height so parent layouts can make room. */
  onHeightChange?: (height: number) => void;
}

const MIN_LINES = 1;
const MAX_LINES = 8;

function isCtrlC(key: { name?: string; sequence?: string; ctrl?: boolean }): boolean {
  return key.sequence === "\u0003" || (key.ctrl === true && key.name === "c");
}

function printableKeyText(key: { name?: string; sequence?: string; ctrl?: boolean; meta?: boolean; super?: boolean }) {
  if (key.ctrl || key.meta || key.super) return undefined;
  if (key.name === "space") return " ";
  if (!key.sequence || key.sequence.length !== 1) return undefined;
  const code = key.sequence.charCodeAt(0);
  if (code < 32 || code === 127) return undefined;
  return key.sequence;
}

export function normalizeSkillAlias(text: string, skillHints: SlashCommand[]): string {
  const match = /^(\s*)\$([^\s]+)(.*)$/s.exec(text);
  if (!match) return text;
  const [, leading = "", name = "", rest = ""] = match;
  if (!skillHints.some((s) => s.name === `$${name}`)) return text;
  return `${leading}/${name}${rest}`;
}

export interface HintToken {
  query: string;
  start: number;
  end: number;
  trigger: "/" | "$" | "@";
}

function clampCursorOffset(text: string, cursor: number | undefined) {
  if (typeof cursor !== "number" || !Number.isFinite(cursor)) return text.length;
  return Math.max(0, Math.min(text.length, Math.floor(cursor)));
}

export function findActiveHintToken(text: string, cursor = text.length): HintToken | null {
  const end = clampCursorOffset(text, cursor);
  const beforeCursor = text.slice(0, end);
  const match = /(^|[\s([{,;])([/$@][^\s]*)$/.exec(beforeCursor);
  if (!match?.[2]) return null;
  const query = match[2];
  const trigger = query[0];
  if (trigger !== "/" && trigger !== "$" && trigger !== "@") return null;
  return {
    query,
    start: end - query.length,
    end,
    trigger,
  };
}

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
  skillHints = SKILL_HINTS,
  subagentMentions = SUBAGENT_MENTIONS,
  variant = "default",
  modelLabel,
  onHeightChange,
}: Props) {
  const [value, setValue] = useState("");
  const [cursorOffset, setCursorOffset] = useState(0);
  const [menuIndex, setMenuIndex] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  // Post-wrap line count read from the textarea ref. Authoritative source
  // for input height — paste, word-wrap, CJK widths all factor in here,
  // unlike a char-count/width estimate done from the React side.
  const [virtualLines, setVirtualLines] = useState(MIN_LINES);
  // Ref to the underlying TextareaRenderable so we can call setText("")
  // to actually clear the buffer after submit.
  const textareaRef = useRef<TextareaRenderable | null>(null);
  const valueRef = useRef(value);
  const lastKnownTextareaTextRef = useRef("");
  const pendingCursorOffsetRef = useRef<number | null>(null);
  // Re-mount counter — bumped on history scrub so the textarea picks up
  // the new initialValue. After submit we clear in-place via the ref.
  const [instanceKey, setInstanceKey] = useState(0);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const readTextareaCursorOffset = useCallback((text: string) => {
    return clampCursorOffset(text, textareaRef.current?.cursorOffset ?? text.length);
  }, []);

  /** Read the textarea's post-wrap line count, clamped to [MIN_LINES, MAX_LINES].
   *  This is the authoritative size — the textarea's editor view recomputes
   *  it after every mutation (insert/delete/paste), accounting for word-wrap,
   *  CJK widths, and explicit newlines. */
  const readVirtualLineCount = useCallback(() => {
    const node = textareaRef.current;
    if (!node) return MIN_LINES;
    const raw = node.virtualLineCount;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1) return MIN_LINES;
    return Math.min(MAX_LINES, Math.max(MIN_LINES, Math.floor(raw)));
  }, []);

  const syncVirtualLineCount = useCallback(() => {
    setVirtualLines((current) => {
      const next = readVirtualLineCount();
      return current === next ? current : next;
    });
  }, [readVirtualLineCount]);

  const enforceTextareaCursorOffset = useCallback((text: string, cursor: number) => {
    const nextCursor = clampCursorOffset(text, cursor);
    const node = textareaRef.current as (TextareaRenderable & {
      editBuffer?: { setCursorByOffset?: (offset: number) => void };
    }) | null;
    try {
      if (node) node.cursorOffset = nextCursor;
    } catch {}
    try {
      node?.editBuffer?.setCursorByOffset?.(nextCursor);
    } catch {}
  }, []);

  const setTextareaCursorOffset = useCallback((text: string, cursor: number) => {
    const nextCursor = clampCursorOffset(text, cursor);
    enforceTextareaCursorOffset(text, nextCursor);
    setCursorOffset(nextCursor);
  }, [enforceTextareaCursorOffset]);

  useEffect(() => {
    const cursor = pendingCursorOffsetRef.current;
    if (cursor === null) return;
    enforceTextareaCursorOffset(value, cursor);
    const timeout = setTimeout(() => {
      enforceTextareaCursorOffset(value, cursor);
      if (pendingCursorOffsetRef.current === cursor) {
        pendingCursorOffsetRef.current = null;
      }
    }, 0);
    return () => clearTimeout(timeout);
  }, [enforceTextareaCursorOffset, value]);

  const setTextareaRef = useCallback((node: TextareaRenderable | null) => {
    textareaRef.current = node;
    const next = node?.plainText ?? node?.editBuffer?.getText?.();
    if (typeof next === "string") {
      lastKnownTextareaTextRef.current = next;
      const pendingCursor = pendingCursorOffsetRef.current;
      if (pendingCursor !== null) {
        setTextareaCursorOffset(next, pendingCursor);
      } else {
        setCursorOffset(clampCursorOffset(next, node?.cursorOffset ?? next.length));
      }
    }
    syncVirtualLineCount();
  }, [setTextareaCursorOffset, syncVirtualLineCount]);

  const activeToken = useMemo(
    () => findActiveHintToken(value, cursorOffset),
    [cursorOffset, value],
  );

  useEffect(() => {
    setMenuIndex(0);
  }, [activeToken?.query]);

  const activeQuery = activeToken?.query ?? "";
  const menuPool = activeToken?.trigger === "/"
    ? slashCommands
    : activeToken?.trigger === "$"
      ? skillHints
      : activeToken?.trigger === "@"
        ? subagentMentions
        : [];
  const menuMatches = activeToken ? menuPool.filter((c) => c.name.startsWith(activeQuery)) : [];
  const showingMenu = activeToken !== null;

  // `virtualLines` is sourced from the textarea's editorView via
  // `syncVirtualLineCount` and reflects the actual post-wrap row count,
  // including paste, word-wrap, and CJK widths. The old char/width estimate
  // under-counted pasted content (word-wrap produces more rows than
  // char-wrap for prose) and let the parent layout squeeze the input.
  const visibleLines = virtualLines;

  const menuHeight = showingMenu ? Math.min(SLASH_MENU_VISIBLE_ROWS, menuMatches.length) + 5 : 0;
  const renderedHeight = menuHeight + visibleLines + (variant === "hero" ? 5 : 3);

  useEffect(() => {
    onHeightChange?.(renderedHeight);
  }, [onHeightChange, renderedHeight]);

  /** Clear the textarea buffer via the renderable's ref. */
  const clearBuffer = () => {
    try {
      textareaRef.current?.editBuffer?.setText("");
    } catch {
      /* harmless — fall through to remount */
    }
    setValue("");
    setCursorOffset(0);
  };

  const readTextareaText = useCallback(() => {
    const next = textareaRef.current?.plainText ?? textareaRef.current?.editBuffer?.getText?.();
    if (typeof next === "string") {
      lastKnownTextareaTextRef.current = next;
      return next;
    }
    return lastKnownTextareaTextRef.current || valueRef.current;
  }, []);

  const syncTextareaText = useCallback(() => {
    const next = readTextareaText();
    setValue(next);
    setCursorOffset(readTextareaCursorOffset(next));
  }, [readTextareaCursorOffset, readTextareaText]);

  const handleTextareaContentChange = useCallback(() => {
    syncTextareaText();
    syncVirtualLineCount();
    queueMicrotask(() => {
      syncTextareaText();
      syncVirtualLineCount();
    });
    setTimeout(() => {
      syncTextareaText();
      syncVirtualLineCount();
    }, 0);
  }, [syncTextareaText, syncVirtualLineCount]);

  const handleTextareaCursorChange = useCallback(() => {
    const next = readTextareaText();
    setCursorOffset(readTextareaCursorOffset(next));
  }, [readTextareaCursorOffset, readTextareaText]);

  // The textarea owns its edit buffer — every key mutates it directly and
  // fires onContentChange, which is where we re-read plainText + cursor +
  // virtualLines. The only thing we need from this handler is the side
  // effect of exiting "history scrub" mode the moment the user starts
  // typing fresh content. Don't mirror state updates here — racing against
  // onContentChange caused cursor jumps and stale height computation.
  const handleTextareaKeyDown = useCallback((key: KeyEvent) => {
    if (printableKeyText(key) !== undefined) {
      setHistoryIdx(null);
    }
  }, []);

  /** Replace the textarea buffer with `text` and update React state. */
  const setBuffer = (text: string, cursor = text.length, remount = false) => {
    const nextCursor = clampCursorOffset(text, cursor);
    try {
      textareaRef.current?.editBuffer?.setText(text);
    } catch {}
    lastKnownTextareaTextRef.current = text;
    pendingCursorOffsetRef.current = nextCursor;
    setValue(text);
    setTextareaCursorOffset(text, nextCursor);
    queueMicrotask(() => setTextareaCursorOffset(text, nextCursor));
    setTimeout(() => setTextareaCursorOffset(text, nextCursor), 0);
    if (remount) setInstanceKey((k) => k + 1);
  };

  useKeyboard((key) => {
    // Ctrl+C: abort the agent if it's working; quit on empty input;
    // otherwise clear the current draft. Always runs — even when busy —
    // so the user can interrupt at any time.
    if (isCtrlC(key)) {
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
      if (key.name === "tab") {
        if (menuMatches.length === 0 || !activeToken) return;
        const chosen = menuMatches[Math.min(menuIndex, menuMatches.length - 1)]!.name;
        const prefix = value.slice(0, activeToken.start);
        const suffix = value.slice(activeToken.end);
        const completed = chosen.startsWith("$") ? `/${chosen.slice(1)}` : chosen;
        const spacer = suffix.startsWith(" ") ? "" : " ";
        const next = prefix + completed + spacer + suffix;
        const cursorAfterCompletion = prefix.length + completed.length + 1;
        setBuffer(next, cursorAfterCompletion, true);
        return;
      }
      if (key.name === "up") {
        if (menuMatches.length === 0) return;
        setMenuIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.name === "down") {
        if (menuMatches.length === 0) return;
        setMenuIndex((i) => Math.min(menuMatches.length - 1, i + 1));
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

    // Enter (no shift, no ctrl/meta): submit. Belt-and-braces with the
    // textarea's onSubmit — whichever fires first wins, the other is
    // deduped via `submitInflightRef`. Some terminal/keymap combos drop
    // the `keyBindings` override on the textarea, so this useKeyboard
    // backstop guarantees Enter always submits.
    if (
      (key.name === "return" || key.name === "kpenter") &&
      !key.shift &&
      !key.ctrl &&
      !key.meta
    ) {
      // Read the latest content from the textarea's buffer in case the
      // React `value` state hasn't propagated this frame yet.
      performSubmit(readTextareaText());
      return;
    }

  });

  // Inflight guard for the Enter belt-and-braces handlers (see useKeyboard
  // above). Released on the next tick.
  const submitInflightRef = useRef(false);

  const performSubmit = (text: string) => {
    // Dedupe across the two Enter paths (useKeyboard backstop + textarea
    // .onSubmit). Whichever fires first wins; the other call returns
    // immediately because the inflight flag is set. The flag is released
    // on the next tick so subsequent submits work.
    if (submitInflightRef.current) return;
    submitInflightRef.current = true;
    setTimeout(() => {
      submitInflightRef.current = false;
    }, 0);
    const t = normalizeSkillAlias(text, skillHints).trim();
    if (!t) return;
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

  // Override OpenTUI's default textarea bindings: Enter submits, Shift+Enter
  // keeps the textarea's native newline action. This mirrors opencode's
  // renderable-first input flow: the textarea mutates its edit buffer, then
  // onContentChange reads `plainText`.
  const submitOnEnterBindings = useMemo(
    () => [
      { name: "return", action: "submit" },
      { name: "kpenter", action: "submit" },
      { name: "linefeed", action: "newline" },
      { name: "return", shift: true, action: "newline" },
      { name: "kpenter", shift: true, action: "newline" },
      { name: "linefeed", shift: true, action: "newline" },
    ],
    [],
  );

  const borderColor = busy ? theme.warning : theme.borderActive;
  const placeholder = busy
    ? "agent is thinking · press ctrl-c to interrupt"
    : "ask, /command, $skill, or @subagent · shift+enter newline";

  if (variant === "hero") {
    // Hero variant: a single rounded box containing the textarea on top,
    // a thin separator, and a model-info row at the bottom. Below the box
    // we render a single tight hint line. Matches the OpenCode landing
    // shape: input is the centrepiece, chrome stays out of the way.
    const accent = busy ? theme.warning : theme.accentSoft;
    return (
      <box flexDirection="column" width={width}>
        <SlashMenu
          query={activeQuery}
          selectedIndex={menuIndex}
          width={width}
          slashCommands={slashCommands}
          skillHints={skillHints}
          subagentMentions={subagentMentions}
        />
        <box
          flexDirection="row"
          border
          borderStyle="rounded"
          borderColor={accent}
          padding={0}
          width={width}
          alignItems="stretch"
        >
          {/* Coloured left accent: a single-cell stripe of background colour. */}
          <box width={1} backgroundColor={accent} />
          <box flexDirection="column" flexGrow={1} paddingX={1} paddingY={0}>
            <box minHeight={MIN_LINES} maxHeight={MAX_LINES} flexDirection="row">
              <textarea
                key={instanceKey}
                ref={setTextareaRef}
                initialValue={value}
                onContentChange={handleTextareaContentChange}
                onCursorChange={handleTextareaCursorChange}
                onSubmit={() => performSubmit(readTextareaText())}
                focused
                minHeight={MIN_LINES}
                maxHeight={MAX_LINES}
                onKeyDown={handleTextareaKeyDown}
                wrapMode="word"
                keyBindings={submitOnEnterBindings as any}
                placeholder={placeholder}
                textColor={theme.text}
                placeholderColor={busy ? theme.warning : theme.textDim}
                backgroundColor="transparent"
                focusedBackgroundColor="transparent"
              />
            </box>
            <box marginTop={1} flexDirection="row">
              <text fg={theme.accentSoft}>
                <strong>Build</strong>
              </text>
              <text fg={theme.textDim}> · </text>
              <text fg={theme.textMuted}>{modelLabel ?? "no model"}</text>
            </box>
          </box>
        </box>
        <box flexDirection="row" justifyContent="flex-end" paddingX={1} marginTop={1}>
          <text fg={theme.textDim}>
            <span fg={theme.text}>tab</span> hints · <span fg={theme.text}>ctrl+m</span> models ·{" "}
            <span fg={theme.text}>ctrl+p</span> commands
          </text>
        </box>
      </box>
    );
  }

  // Default variant — pinned at the bottom of the chat layout.
  const promptGlyph = busy ? "…" : "›";
  return (
    <box flexDirection="column" width={width}>
      <SlashMenu
        query={activeQuery}
        selectedIndex={menuIndex}
        width={width}
        slashCommands={slashCommands}
        skillHints={skillHints}
        subagentMentions={subagentMentions}
      />
      <box
        flexDirection="row"
        border
        borderStyle="rounded"
        borderColor={borderColor}
        padding={0}
        width={width}
        alignItems="stretch"
      >
        <box width={1} backgroundColor={busy ? theme.warning : theme.accentSoft} />
        <box flexDirection="row" flexGrow={1} paddingX={1} alignItems="flex-start" minHeight={MIN_LINES}>
          <text fg={busy ? theme.warning : theme.accent}>
            <strong>{promptGlyph}</strong>
          </text>
          <text> </text>
          <box flexGrow={1} minHeight={MIN_LINES} maxHeight={MAX_LINES}>
            <textarea
              key={instanceKey}
              ref={setTextareaRef}
              initialValue={value}
              onContentChange={handleTextareaContentChange}
              onCursorChange={handleTextareaCursorChange}
              onSubmit={() => performSubmit(readTextareaText())}
              focused
              minHeight={MIN_LINES}
              maxHeight={MAX_LINES}
              onKeyDown={handleTextareaKeyDown}
              wrapMode="word"
              keyBindings={submitOnEnterBindings as any}
              placeholder={placeholder}
              textColor={theme.text}
              placeholderColor={busy ? theme.warning : theme.textDim}
              backgroundColor="transparent"
              focusedBackgroundColor="transparent"
            />
          </box>
        </box>
      </box>
      <box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <text fg={theme.textDim}>
          {busy ? "Running · Ctrl-C to stop" : modelLabel ?? ""}
        </text>
        <text fg={theme.textDim}>
          <span fg={theme.text}>tab</span> hints · <span fg={theme.text}>ctrl+m</span> models ·{" "}
          <span fg={theme.text}>ctrl+p</span> commands
        </text>
      </box>
    </box>
  );
}
