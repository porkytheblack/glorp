import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import { SLASH_COMMANDS, SKILL_HINTS, SLASH_MENU_VISIBLE_ROWS, SUBAGENT_MENTIONS } from "./slash-menu.tsx";
import type { SlashCommand } from "./slash-menu.tsx";
import {
  clampCursorOffset,
  findActiveHintToken,
  isCtrlC,
  normalizeSkillAlias,
  printableKeyText,
} from "./input-bar/helpers.ts";
import { DefaultVariant, HeroVariant } from "./input-bar/variants.tsx";

export { findActiveHintToken, normalizeSkillAlias } from "./input-bar/helpers.ts";
export type { HintToken } from "./input-bar/helpers.ts";

interface Props {
  busy: boolean;
  onSubmit: (text: string) => void;
  onAbort: () => void;
  onQuit: () => void;
  width: number;
  slashCommands?: SlashCommand[];
  skillHints?: SlashCommand[];
  subagentMentions?: SlashCommand[];
  variant?: "default" | "hero";
  modelLabel?: string;
  onHeightChange?: (height: number) => void;
}

const MIN_LINES = 1;
const MAX_LINES = 8;

/**
 * Auto-growing chat input. Holds the buffered text + cursor state and wires
 * keyboard handlers; the two render variants live in `./input-bar/variants.tsx`.
 */
export function InputBar({
  busy, onSubmit, onAbort, onQuit, width,
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
  const textareaRef = useRef<TextareaRenderable | null>(null);
  const valueRef = useRef(value);
  const lastKnownTextareaTextRef = useRef("");
  const pendingCursorOffsetRef = useRef<number | null>(null);
  const [instanceKey, setInstanceKey] = useState(0);

  useEffect(() => { valueRef.current = value; }, [value]);

  const readTextareaCursorOffset = useCallback((text: string) => {
    return clampCursorOffset(text, textareaRef.current?.cursorOffset ?? text.length);
  }, []);

  const enforceTextareaCursorOffset = useCallback((text: string, cursor: number) => {
    const nextCursor = clampCursorOffset(text, cursor);
    const node = textareaRef.current as (TextareaRenderable & {
      editBuffer?: { setCursorByOffset?: (offset: number) => void };
    }) | null;
    try { if (node) node.cursorOffset = nextCursor; } catch {}
    try { node?.editBuffer?.setCursorByOffset?.(nextCursor); } catch {}
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
      if (pendingCursorOffsetRef.current === cursor) pendingCursorOffsetRef.current = null;
    }, 0);
    return () => clearTimeout(timeout);
  }, [enforceTextareaCursorOffset, value]);

  const setTextareaRef = useCallback((node: TextareaRenderable | null) => {
    textareaRef.current = node;
    const next = node?.plainText ?? node?.editBuffer?.getText?.();
    if (typeof next === "string") {
      lastKnownTextareaTextRef.current = next;
      const pendingCursor = pendingCursorOffsetRef.current;
      if (pendingCursor !== null) setTextareaCursorOffset(next, pendingCursor);
      else setCursorOffset(clampCursorOffset(next, node?.cursorOffset ?? next.length));
    }
  }, [setTextareaCursorOffset]);

  const activeToken = useMemo(() => findActiveHintToken(value, cursorOffset), [cursorOffset, value]);
  useEffect(() => { setMenuIndex(0); }, [activeToken?.query]);

  const activeQuery = activeToken?.query ?? "";
  const menuPool = activeToken?.trigger === "/" ? slashCommands
    : activeToken?.trigger === "$" ? skillHints
    : activeToken?.trigger === "@" ? subagentMentions
    : [];
  const menuMatches = activeToken ? menuPool.filter((c) => c.name.startsWith(activeQuery)) : [];
  const showingMenu = activeToken !== null;

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
  const menuHeight = showingMenu ? Math.min(SLASH_MENU_VISIBLE_ROWS, menuMatches.length) + 5 : 0;
  const renderedHeight = menuHeight + visibleLines + (variant === "hero" ? 5 : 3);
  useEffect(() => { onHeightChange?.(renderedHeight); }, [onHeightChange, renderedHeight]);

  const clearBuffer = () => {
    try { textareaRef.current?.editBuffer?.setText(""); } catch {}
    setValue("");
    setCursorOffset(0);
  };

  const readTextareaText = useCallback(() => {
    const next = textareaRef.current?.plainText ?? textareaRef.current?.editBuffer?.getText?.();
    if (typeof next === "string") { lastKnownTextareaTextRef.current = next; return next; }
    return lastKnownTextareaTextRef.current || valueRef.current;
  }, []);

  const syncTextareaText = useCallback(() => {
    const next = readTextareaText();
    setValue(next);
    setCursorOffset(readTextareaCursorOffset(next));
  }, [readTextareaCursorOffset, readTextareaText]);

  const handleContentChange = useCallback(() => {
    syncTextareaText();
    queueMicrotask(syncTextareaText);
    setTimeout(syncTextareaText, 0);
  }, [syncTextareaText]);

  const handleCursorChange = useCallback(() => {
    const next = readTextareaText();
    setCursorOffset(readTextareaCursorOffset(next));
  }, [readTextareaCursorOffset, readTextareaText]);

  const handleKeyDown = useCallback((key: KeyEvent) => {
    if (key.name === "backspace") {
      setValue((current) => current.slice(0, -1));
      setCursorOffset((current) => Math.max(0, current - 1));
      return;
    }
    if ((key.name === "return" || key.name === "kpenter" || key.name === "linefeed") &&
        (key.shift || key.name === "linefeed") && !key.ctrl && !key.meta) {
      setValue((current) => `${current}\n`);
      setCursorOffset((current) => current + 1);
      return;
    }
    const typed = printableKeyText(key);
    if (typed !== undefined) {
      setHistoryIdx(null);
      setValue((current) => `${current}${typed}`);
      setCursorOffset((current) => current + typed.length);
    }
  }, []);

  const setBuffer = (text: string, cursor = text.length, remount = false) => {
    const nextCursor = clampCursorOffset(text, cursor);
    try { textareaRef.current?.editBuffer?.setText(text); } catch {}
    lastKnownTextareaTextRef.current = text;
    pendingCursorOffsetRef.current = nextCursor;
    setValue(text);
    setTextareaCursorOffset(text, nextCursor);
    queueMicrotask(() => setTextareaCursorOffset(text, nextCursor));
    setTimeout(() => setTextareaCursorOffset(text, nextCursor), 0);
    if (remount) setInstanceKey((k) => k + 1);
  };

  const submitInflightRef = useRef(false);
  const performSubmit = (text: string) => {
    if (submitInflightRef.current) return;
    submitInflightRef.current = true;
    setTimeout(() => { submitInflightRef.current = false; }, 0);
    const t = normalizeSkillAlias(text, skillHints).trim();
    if (!t || busy) return;
    clearBuffer();
    setHistoryIdx(null);
    setHistory((h) => (h.at(-1) === t ? h : [...h, t]).slice(-50));
    if (t === "/quit" || t === "/exit") { onQuit(); return; }
    if (t === "/help") onSubmit("/help — list commands and tools available in this session");
    else onSubmit(t);
  };

  useKeyboard((key) => {
    if (isCtrlC(key)) {
      if (busy) onAbort();
      else if (value === "") onQuit();
      else clearBuffer();
      return;
    }
    if (showingMenu && key.name === "tab") {
      if (menuMatches.length === 0 || !activeToken) return;
      const chosen = menuMatches[Math.min(menuIndex, menuMatches.length - 1)]!.name;
      const prefix = value.slice(0, activeToken.start);
      const suffix = value.slice(activeToken.end);
      const completed = chosen.startsWith("$") ? `/${chosen.slice(1)}` : chosen;
      const spacer = suffix.startsWith(" ") ? "" : " ";
      setBuffer(prefix + completed + spacer + suffix, prefix.length + completed.length + 1, true);
      return;
    }
    if (showingMenu && key.name === "up" && menuMatches.length > 0) { setMenuIndex((i) => Math.max(0, i - 1)); return; }
    if (showingMenu && key.name === "down" && menuMatches.length > 0) { setMenuIndex((i) => Math.min(menuMatches.length - 1, i + 1)); return; }
    if (key.name === "up" && value === "" && history.length > 0) {
      const next = historyIdx === null ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(next); setBuffer(history[next]!); setInstanceKey((k) => k + 1); return;
    }
    if (key.name === "down" && historyIdx !== null) {
      const next = historyIdx + 1;
      if (next >= history.length) { setHistoryIdx(null); clearBuffer(); setInstanceKey((k) => k + 1); }
      else { setHistoryIdx(next); setBuffer(history[next]!); setInstanceKey((k) => k + 1); }
      return;
    }
    if ((key.name === "return" || key.name === "kpenter") && !key.shift && !key.ctrl && !key.meta) {
      performSubmit(readTextareaText());
    }
  });

  const submitOnEnterBindings = useMemo(() => [
    { name: "return", action: "submit" },
    { name: "kpenter", action: "submit" },
    { name: "linefeed", action: "newline" },
    { name: "return", shift: true, action: "newline" },
    { name: "kpenter", shift: true, action: "newline" },
    { name: "linefeed", shift: true, action: "newline" },
  ], []);

  const placeholder = busy
    ? "agent is thinking · press ctrl-c to interrupt"
    : "ask, /command, $skill, or @subagent · shift+enter newline";

  const variantProps = {
    width, busy, modelLabel, activeQuery, menuIndex,
    slashCommands, skillHints, subagentMentions,
    textareaProps: {
      instanceKey,
      setRef: setTextareaRef,
      initialValue: value,
      onContentChange: handleContentChange,
      onCursorChange: handleCursorChange,
      onSubmit: () => performSubmit(readTextareaText()),
      onKeyDown: handleKeyDown,
      keyBindings: submitOnEnterBindings,
      placeholder,
      minLines: MIN_LINES,
      maxLines: MAX_LINES,
    },
  };
  return variant === "hero" ? <HeroVariant {...variantProps} /> : <DefaultVariant {...variantProps} />;
}
