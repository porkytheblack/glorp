import React, { useState, useEffect, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import { theme } from "../theme.ts";
import { SlashMenu, SLASH_COMMANDS, SUBAGENT_MENTIONS } from "./slash-menu.tsx";

/**
 * Tiny typed wrapper around OpenTUI's `<input>` intrinsic. The intrinsic's
 * type collides with React DOM's `HTMLInputElement` props because OpenTUI
 * extends `React.JSX.IntrinsicElements` — `onSubmit` ends up intersected
 * between OpenTUI's `(value: string) => void` and the DOM's
 * `(event: SubmitEvent) => void`, which no single function shape can
 * satisfy. We hide that here so the rest of the code can pass a clean
 * `(value: string) => void` callback.
 */
interface GlorpInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  focused?: boolean;
  textColor?: string;
  placeholderColor?: string;
  cursorColor?: string;
  backgroundColor?: string;
  focusedBackgroundColor?: string;
}

function GlorpInput(props: GlorpInputProps): React.ReactElement {
  return React.createElement("input", props as unknown as React.InputHTMLAttributes<HTMLInputElement>);
}

interface Props {
  busy: boolean;
  onSubmit: (text: string) => void;
  onAbort: () => void;
  onQuit: () => void;
  width: number;
}

export function InputBar({ busy, onSubmit, onAbort, onQuit, width }: Props) {
  const [value, setValue] = useState("");
  const [menuIndex, setMenuIndex] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const submittingRef = useRef(false);

  // Reset menu position when the leading token changes.
  useEffect(() => {
    setMenuIndex(0);
  }, [value.split(/\s/)[0]]);

  const lastToken = value.split(/\s/).at(-1) ?? "";
  const showingMenu = lastToken.startsWith("/") || lastToken.startsWith("@");

  useKeyboard((key) => {
    if (submittingRef.current) return;

    // Global: ctrl-c — abort if busy, quit if not (twice within 1s).
    if (key.name === "c" && key.ctrl) {
      if (busy) {
        onAbort();
      } else if (value === "") {
        onQuit();
      } else {
        setValue("");
      }
      return;
    }

    if (showingMenu) {
      const pool = lastToken.startsWith("/") ? SLASH_COMMANDS : SUBAGENT_MENTIONS;
      const matches = pool.filter((c) => c.name.startsWith(lastToken));
      if (key.name === "tab" && matches.length > 0) {
        const chosen = matches[Math.min(menuIndex, matches.length - 1)]!.name;
        const prefix = value.slice(0, value.length - lastToken.length);
        setValue(prefix + chosen + " ");
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
      return;
    }
    if (key.name === "down" && historyIdx !== null) {
      const next = historyIdx + 1;
      if (next >= history.length) {
        setHistoryIdx(null);
        setValue("");
      } else {
        setHistoryIdx(next);
        setValue(history[next]!);
      }
      return;
    }
  });

  const handleSubmit = (text: string) => {
    const t = text.trim();
    if (!t) return;
    submittingRef.current = true;
    setValue("");
    setHistoryIdx(null);
    setHistory((h) => (h.at(-1) === t ? h : [...h, t]).slice(-50));
    if (t === "/quit" || t === "/exit") {
      onQuit();
      return;
    }
    if (t === "/help") {
      // Helper: hijack and treat as a hint
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
        height={3}
        width={width}
      >
        <text fg={busy ? theme.warning : theme.accent}>
          <strong>{busy ? "…" : "›"}</strong>
        </text>
        <text> </text>
        <GlorpInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          focused
          placeholder={
            busy
              ? "glorp is working… (ctrl-c to abort)"
              : "ask, command, or /slash · @subagent · ctrl-c to quit"
          }
          textColor={theme.text}
          placeholderColor={theme.textDim}
          cursorColor={theme.accent}
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
        />
      </box>
      <box flexDirection="row" paddingX={1}>
        <text fg={theme.textDim}>
          enter ↩ send · tab ⇥ complete · ↑↓ history · ctrl-c abort/quit
        </text>
      </box>
    </box>
  );
}
