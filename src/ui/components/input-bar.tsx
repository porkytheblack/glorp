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
  variant = "default",
  modelLabel,
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

    // Enter (no shift, no ctrl/meta): submit. Belt-and-braces with the
    // textarea's onSubmit — whichever fires first wins, the other is
    // deduped via `lastSubmitMsRef`. Some terminal/keymap combos drop
    // the `keyBindings` override on the textarea, so this useKeyboard
    // backstop guarantees Enter always submits.
    if (
      (key.name === "return" || key.name === "kpenter" || key.name === "linefeed") &&
      !key.shift &&
      !key.ctrl &&
      !key.meta
    ) {
      // Read the latest content from the textarea's buffer in case the
      // React `value` state hasn't propagated this frame yet.
      const latest = (textareaRef.current as { plainText?: string } | null)?.plainText ?? value;
      performSubmit(latest);
      return;
    }

    // Shift+Enter: insert a newline at the cursor. Backstop for envs where
    // the textarea's keymap override doesn't apply. The textarea also
    // handles this via its keymap; we dedupe via newlineInflightRef so
    // we don't insert two newlines.
    if (
      (key.name === "return" || key.name === "kpenter" || key.name === "linefeed") &&
      key.shift &&
      !key.ctrl &&
      !key.meta
    ) {
      if (newlineInflightRef.current) return;
      newlineInflightRef.current = true;
      setTimeout(() => {
        newlineInflightRef.current = false;
      }, 0);
      const ed = textareaRef.current?.editBuffer;
      const eb = ed as { insertText?: (s: string) => void } | undefined;
      if (eb && typeof eb.insertText === "function") {
        eb.insertText("\n");
      } else {
        setValue((v) => v + "\n");
        setInstanceKey((k) => k + 1);
      }
      return;
    }
  });

  // Inflight guards for the Enter/Shift+Enter belt-and-braces handlers
  // (see useKeyboard above). Released on the next tick.
  const submitInflightRef = useRef(false);
  const newlineInflightRef = useRef(false);

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
    const t = text.trim();
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
  // inserts a newline. Defaults map plain Enter to newline and only fire
  // submit on Cmd/Meta+Enter, which doesn't match the chat UX every other
  // app in the world uses. `keyBindings` is merged onto defaults — same
  // name+modifier combination replaces, so listing the three Enter
  // variants under both modifier states does the swap cleanly.
  const submitOnEnterBindings = useMemo(
    () => [
      { name: "return", action: "submit" },
      { name: "kpenter", action: "submit" },
      { name: "linefeed", action: "submit" },
      { name: "return", shift: true, action: "newline" },
      { name: "kpenter", shift: true, action: "newline" },
    ],
    [],
  );

  const borderColor = busy ? theme.warning : theme.borderActive;
  const placeholder = busy
    ? "Running · Ctrl-C to stop"
    : "Message Glorp or type /";

  if (variant === "hero") {
    // Hero variant: a single rounded box containing the textarea on top,
    // a thin separator, and a model-info row at the bottom. Below the box
    // we render a single tight hint line. Matches the OpenCode landing
    // shape: input is the centrepiece, chrome stays out of the way.
    const accent = busy ? theme.warning : theme.accentSoft;
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
          borderStyle="rounded"
          borderColor={accent}
          padding={0}
          width={width}
          alignItems="stretch"
        >
          {/* Coloured left accent: a single-cell stripe of background colour. */}
          <box width={1} backgroundColor={accent} />
          <box flexDirection="column" flexGrow={1} paddingX={1} paddingY={0}>
            <box height={visibleLines} flexDirection="row">
              <GlorpTextarea
                key={instanceKey}
                innerRef={textareaRef}
                initialValue={value}
                onContentChange={setValue}
                onSubmit={() => performSubmit(value)}
                focused
                wrapMode="word"
                keyBindings={submitOnEnterBindings}
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
            <span fg={theme.text}>tab</span> agents · <span fg={theme.text}>ctrl+m</span> models ·{" "}
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
        query={lastToken}
        selectedIndex={menuIndex}
        width={width}
        slashCommands={slashCommands}
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
        <box flexDirection="row" flexGrow={1} paddingX={1} alignItems="flex-start" height={boxHeight - 2}>
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
              keyBindings={submitOnEnterBindings}
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
          <span fg={theme.text}>tab</span> agents · <span fg={theme.text}>ctrl+m</span> models ·{" "}
          <span fg={theme.text}>ctrl+p</span> commands
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
  /** Custom key bindings merged onto OpenTUI's defaults. */
  keyBindings?: Array<{ name: string; ctrl?: boolean; shift?: boolean; meta?: boolean; super?: boolean; action: string }>;
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
