import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import type { TextareaRenderable } from "@opentui/core";
import { theme } from "../theme.ts";
import { SlashMenu, SLASH_COMMANDS, SKILL_HINTS, SUBAGENT_MENTIONS } from "./slash-menu.tsx";
import type { SlashCommand } from "./slash-menu.tsx";
import { useImagePaste, type PendingImage } from "../hooks/use-image-paste.ts";

interface Props {
  busy: boolean; onSubmit: (text: string, images?: PendingImage[]) => void; onAbort: () => void; onQuit: () => void;
  width: number; slashCommands?: SlashCommand[]; skillHints?: SlashCommand[];
  subagentMentions?: SlashCommand[]; modelLabel?: string; variant?: "default" | "hero";
  onHeightChange?: (height: number) => void;
}
const MIN_LINES = 1;
const MAX_LINES = 8;

export function InputBar({
  busy, onSubmit, onAbort, onQuit, width,
  slashCommands = SLASH_COMMANDS, skillHints = SKILL_HINTS,
  subagentMentions = SUBAGENT_MENTIONS, modelLabel, variant = "default",
  onHeightChange,
}: Props) {
  const [value, setValue] = useState("");
  const [cursorOffset, setCursorOffset] = useState(0);
  const [menuIndex, setMenuIndex] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const [virtualLines, setVirtualLines] = useState(MIN_LINES);
  const textareaRef = useRef<TextareaRenderable | null>(null);
  const [instanceKey, setInstanceKey] = useState(0);
  const submitInflightRef = useRef(false);
  const { images: pendingImages, clear: clearImages } = useImagePaste();

  const activeToken = useMemo(() => findHintToken(value, cursorOffset), [cursorOffset, value]);
  useEffect(() => { setMenuIndex(0); }, [activeToken?.query]);
  const activeQuery = activeToken?.query ?? "";
  const menuPool = activeToken?.trigger === "/"
    ? slashCommands : activeToken?.trigger === "$" ? skillHints
    : activeToken?.trigger === "@" ? subagentMentions : [];
  const menuMatches = activeToken ? menuPool.filter((c) => c.name.startsWith(activeQuery)) : [];
  const showingMenu = activeToken !== null;

  const readText = useCallback(() => {
    const t = textareaRef.current?.plainText ?? textareaRef.current?.editBuffer?.getText?.();
    return typeof t === "string" ? t : value;
  }, [value]);

  const clearBuffer = useCallback(() => {
    try { textareaRef.current?.editBuffer?.setText(""); } catch {}
    setValue(""); setCursorOffset(0); clearImages();
  }, [clearImages]);

  const performSubmit = useCallback((text: string) => {
    if (submitInflightRef.current) return;
    submitInflightRef.current = true;
    setTimeout(() => { submitInflightRef.current = false; }, 0);
    const t = normalizeSkillAlias(text, skillHints).trim();
    if ((!t && !pendingImages.length) || busy) return;
    const imgs = pendingImages.length ? [...pendingImages] : undefined;
    clearBuffer();
    setHistoryIdx(null);
    if (t) setHistory((h) => (h.at(-1) === t ? h : [...h, t]).slice(-50));
    if (t === "/quit" || t === "/exit") { onQuit(); return; }
    onSubmit(t === "/help" ? "/help — list commands and tools available in this session" : t || "What's in this image?", imgs);
  }, [busy, clearBuffer, onQuit, onSubmit, skillHints, pendingImages]);

  const syncText = useCallback(() => {
    const next = readText();
    setValue(next);
    setCursorOffset(textareaRef.current?.cursorOffset ?? next.length);
    const lc = textareaRef.current?.virtualLineCount;
    if (typeof lc === "number" && lc >= 1)
      setVirtualLines(Math.min(MAX_LINES, Math.max(MIN_LINES, lc)));
  }, [readText]);

  const renderedHeight = (showingMenu ? Math.min(8, menuMatches.length) + 5 : 0)
    + virtualLines + (variant === "hero" ? 5 : 3);
  useEffect(() => { onHeightChange?.(renderedHeight); }, [onHeightChange, renderedHeight]);

  useKeyboard((key) => {
    if (isCtrlC(key)) {
      if (busy) onAbort();
      else if (value === "") onQuit();
      else clearBuffer();
      return;
    }
    if (showingMenu) {
      if (key.name === "tab" && menuMatches.length > 0 && activeToken) {
        const chosen = menuMatches[Math.min(menuIndex, menuMatches.length - 1)]!.name;
        const prefix = value.slice(0, activeToken.start);
        const suffix = value.slice(activeToken.end);
        const completed = chosen.startsWith("$") ? `/${chosen.slice(1)}` : chosen;
        const next = prefix + completed + (suffix.startsWith(" ") ? "" : " ") + suffix;
        try { textareaRef.current?.editBuffer?.setText(next); } catch {}
        setValue(next); setInstanceKey((k) => k + 1); return;
      }
      if (key.name === "up") { setMenuIndex((i) => Math.max(0, i - 1)); return; }
      if (key.name === "down") { setMenuIndex((i) => Math.min(menuMatches.length - 1, i + 1)); return; }
    }
    if (key.name === "up" && value === "" && history.length > 0) {
      const next = historyIdx === null ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(next); setValue(history[next]!); setInstanceKey((k) => k + 1); return;
    }
    if (key.name === "down" && historyIdx !== null) {
      const next = historyIdx + 1;
      if (next >= history.length) { setHistoryIdx(null); clearBuffer(); }
      else { setHistoryIdx(next); setValue(history[next]!); }
      setInstanceKey((k) => k + 1); return;
    }
    if ((key.name === "return" || key.name === "kpenter") && !key.shift && !key.ctrl && !key.meta) {
      performSubmit(readText()); return;
    }
  });

  const bindings = useMemo(() => [
    { name: "return", action: "submit" }, { name: "kpenter", action: "submit" },
    { name: "linefeed", action: "newline" },
    { name: "return", shift: true, action: "newline" },
    { name: "kpenter", shift: true, action: "newline" },
  ], []);

  const borderColor = busy ? theme.warning : theme.borderActive;
  const placeholder = busy ? "agent is thinking · ctrl-c to interrupt" : "ask, /command, or @subagent";
  const promptGlyph = busy ? "…" : "›";

  const accent = variant === "hero" ? (busy ? theme.warning : theme.accentSoft) : borderColor;
  const menuEl = <SlashMenu query={activeQuery} selectedIndex={menuIndex} width={width}
    slashCommands={slashCommands} skillHints={skillHints} subagentMentions={subagentMentions} />;
  const taEl = (
    <textarea key={instanceKey} ref={setRef} initialValue={value}
      onContentChange={syncText} onSubmit={() => performSubmit(readText())}
      focused minHeight={MIN_LINES} maxHeight={MAX_LINES} wrapMode="word"
      keyBindings={bindings as any} placeholder={placeholder} textColor={theme.text}
      placeholderColor={busy ? theme.warning : theme.textDim}
      backgroundColor="transparent" focusedBackgroundColor="transparent" />
  );
  if (variant === "hero") {
    return (
      <box flexDirection="column" width={width}>
        {menuEl}
        <box flexDirection="row" border borderStyle="rounded" borderColor={accent} width={width}>
          <box width={1} backgroundColor={accent} />
          <box flexDirection="column" flexGrow={1} paddingX={1}>
            <box minHeight={MIN_LINES} maxHeight={MAX_LINES}>{taEl}</box>
            <box marginTop={1} flexDirection="row">
              <text fg={theme.accentSoft}><strong>Build</strong></text>
              <text fg={theme.textDim}> · </text>
              <text fg={theme.textMuted}>{modelLabel ?? "no model"}</text>
              {pendingImages.length > 0 && <text fg={theme.accent}>{" · 📎"}{pendingImages.length}</text>}
            </box>
          </box>
        </box>
      </box>
    );
  }
  return (
    <box flexDirection="column" width={width}>
      {menuEl}
      <box flexDirection="row" border borderStyle="rounded" borderColor={borderColor} width={width}>
        <box width={1} backgroundColor={busy ? theme.warning : theme.accentSoft} />
        <box flexDirection="row" flexGrow={1} paddingX={1} alignItems="flex-start" minHeight={MIN_LINES}>
          <text fg={busy ? theme.warning : theme.accent}><strong>{promptGlyph}</strong></text>
          <text> </text>
          <box flexGrow={1} minHeight={MIN_LINES} maxHeight={MAX_LINES}>{taEl}</box>
          {pendingImages.length > 0 && <text fg={theme.accent}>{" 📎"}{pendingImages.length}</text>}
        </box>
      </box>
    </box>
  );

  function setRef(node: TextareaRenderable | null) {
    textareaRef.current = node;
    if (node) syncText();
  }
}

function isCtrlC(key: { sequence?: string; ctrl?: boolean; name?: string }): boolean {
  return key.sequence === "" || (key.ctrl === true && key.name === "c");
}

function normalizeSkillAlias(text: string, skillHints: SlashCommand[]): string {
  const m = /^(\s*)\$([^\s]+)(.*)$/s.exec(text);
  if (!m) return text;
  const [, lead = "", name = "", rest = ""] = m;
  if (!skillHints.some((s) => s.name === `$${name}`)) return text;
  return `${lead}/${name}${rest}`;
}

function findHintToken(text: string, cursor: number) {
  const end = Math.max(0, Math.min(text.length, cursor));
  const before = text.slice(0, end);
  const m = /(^|[\s([{,;])([/$@][^\s]*)$/.exec(before);
  if (!m?.[2]) return null;
  const query = m[2]; const trigger = query[0];
  if (trigger !== "/" && trigger !== "$" && trigger !== "@") return null;
  return { query, start: end - query.length, end, trigger: trigger as "/" | "$" | "@" };
}
