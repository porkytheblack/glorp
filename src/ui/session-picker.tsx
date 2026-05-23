import React, { useEffect, useMemo, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import {
  deleteSession,
  listSessions,
  newSessionId,
  relativeTime,
} from "../agent/sessions.ts";
import type { SessionInfo } from "../agent/sessions.ts";
import { theme, BANNER } from "./theme.ts";

interface Props {
  dataDir: string;
  /**
   * Variant of the picker. "launch" shows the full ASCII banner and a
   * welcome line; "overlay" shows a compact rounded-border panel for
   * mid-run Ctrl+S switching.
   */
  variant?: "launch" | "overlay";
  activeSessionId?: string;
  onPick: (sessionId: string) => void;
  onNew: () => void;
  onClose?: () => void;
}

const LIST_LIMIT = 20;

export function SessionPicker({
  dataDir,
  variant = "launch",
  activeSessionId,
  onPick,
  onNew,
  onClose,
}: Props) {
  const { width, height } = useTerminalDimensions();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [cursor, setCursor] = useState(0);
  const [tick, setTick] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  useEffect(() => {
    listSessions(dataDir)
      .then((s) => {
        setSessions(s);
        setCursor(0);
      })
      .catch(() => {
        // Picker just shows empty state on read failure — the next render
        // covers it. No need to crash.
      });
  }, [dataDir, tick]);

  const shown = useMemo(() => sessions.slice(0, LIST_LIMIT), [sessions]);
  const clamped = Math.min(cursor, Math.max(0, shown.length - 1));

  useKeyboard((key) => {
    if (confirmingDelete) {
      if (key.name === "y") {
        void deleteSession(dataDir, confirmingDelete).then(() => {
          setConfirmingDelete(null);
          setTick((t) => t + 1);
        });
      } else if (key.name === "n" || key.name === "escape") {
        setConfirmingDelete(null);
      }
      return;
    }
    if (key.name === "escape" && onClose) return onClose();
    if (key.name === "up" || key.name === "k") {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.name === "down" || key.name === "j") {
      setCursor((c) => Math.min(Math.max(0, shown.length - 1), c + 1));
      return;
    }
    if (key.name === "return") {
      const s = shown[clamped];
      if (s) onPick(s.id);
      return;
    }
    if (key.name === "n") {
      onNew();
      return;
    }
    if (key.name === "d") {
      const s = shown[clamped];
      if (s && s.id !== activeSessionId) setConfirmingDelete(s.id);
      return;
    }
  });

  const showBanner = variant === "launch" && width >= 60;

  const panel = (
    <box
      flexDirection="column"
      padding={1}
      border={variant === "overlay"}
      borderStyle="rounded"
      borderColor={theme.borderActive}
      backgroundColor={variant === "overlay" ? theme.bgPanel : theme.bg}
      width={variant === "overlay" ? Math.min(96, Math.max(60, width - 8)) : undefined}
    >
      <box flexDirection="row">
        <text fg={theme.accent}>
          <strong>{variant === "launch" ? "resume a session" : "switch session"}</strong>
        </text>
        <text fg={theme.textMuted}> · {sessions.length} found</text>
      </box>
      <text fg={theme.textDim}>↑↓ pick · enter resume · n new · d delete · esc {variant === "launch" ? "quit" : "close"}</text>
      <box marginTop={1} flexDirection="column">
        {shown.length === 0 && (
          <text fg={theme.textMuted}>
            no sessions yet — press <span fg={theme.accent}>n</span> to start fresh.
          </text>
        )}
        {shown.map((s, i) => {
          const active = s.id === activeSessionId;
          const highlighted = i === clamped;
          const fg = highlighted ? theme.bg : active ? theme.accent : theme.text;
          const bg = highlighted ? theme.accent : "transparent";
          const star = active ? "●" : "○";
          const preview = (s.title ?? s.firstUserMessage ?? "(no user message yet)")
            .replace(/\s+/g, " ")
            .slice(0, 60);
          const meta = `${s.totalMessages}m · ${s.turnCount}t · ${formatTokens(s.tokenCount)}tk · ${relativeTime(s.lastActivity)}`;
          return (
            <box key={s.id} flexDirection="column">
              <text fg={fg} bg={bg}>{` ${star} ${preview.padEnd(60, " ")}  ${meta.padStart(30, " ")} `}</text>
            </box>
          );
        })}
      </box>
      {confirmingDelete && (
        <box marginTop={1} flexDirection="column">
          <text fg={theme.warning}>
            <strong>delete session "{confirmingDelete}"?</strong>
          </text>
          <text fg={theme.textMuted}>y to confirm · n/esc to cancel</text>
        </box>
      )}
    </box>
  );

  if (variant === "overlay") {
    return (
      <box
        flexDirection="column"
        width={width}
        height={height}
        backgroundColor={theme.bg}
        justifyContent="center"
        alignItems="center"
      >
        {panel}
      </box>
    );
  }

  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={theme.bg}
      padding={2}
    >
      {showBanner &&
        BANNER.map((line, i) => (
          <text key={i} fg={theme.accent}>
            {line}
          </text>
        ))}
      <text fg={theme.text}>
        <span fg={theme.accent}>glorp</span> — welcome back, friend-shape.
      </text>
      <text fg={theme.textMuted}>
        Pick up where you left off, or start fresh. (you can switch sessions later with Ctrl+S.)
      </text>
      <box flexGrow={1} marginTop={1}>
        {panel}
      </box>
    </box>
  );
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}

export { newSessionId };
