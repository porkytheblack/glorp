import React, { useEffect, useMemo, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { theme } from "./theme.ts";
import { OverlayHost, OverlayPanel } from "./overlay-host.tsx";
import type { GlorpClient } from "../client/client.ts";

interface SessionInfo {
  id: string;
  title?: string;
  first_user_message?: string;
  total_messages: number;
  turn_count: number;
  token_count: number;
  last_activity: string;
}

interface Props {
  client: GlorpClient;
  activeSessionId?: string;
  workspace?: string;
  onPick: (sessionId: string) => void;
  onNew: () => void;
  onClose: () => void;
}

const LIST_LIMIT = 20;

export function SessionPicker({ client, activeSessionId, workspace, onPick, onNew, onClose }: Props) {
  const { width, height } = useTerminalDimensions();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    client.listSessions(workspace, LIST_LIMIT)
      .then((res) => {
        setSessions((res as { sessions: SessionInfo[] }).sessions ?? []);
        setLoaded(true);
      })
      .catch(() => { setLoaded(true); });
  }, [client, workspace]);

  const shown = useMemo(() => sessions.slice(0, LIST_LIMIT), [sessions]);
  const clamped = Math.min(cursor, Math.max(0, shown.length - 1));

  useKeyboard((key) => {
    if (key.name === "escape") return onClose();
    if (key.name === "up" || key.name === "k") {
      setCursor((c) => Math.max(0, c - 1)); return;
    }
    if (key.name === "down" || key.name === "j") {
      setCursor((c) => Math.min(Math.max(0, shown.length - 1), c + 1)); return;
    }
    if (key.name === "return") {
      const s = shown[clamped];
      if (s) onPick(s.id); return;
    }
    if (key.name === "n") { onNew(); return; }
  });

  const panelW = Math.min(96, Math.max(60, width - 8));

  return (
    <OverlayHost width={width} height={height}>
      <OverlayPanel
        title="switch session"
        titleColor={theme.accent}
        hint="up/down pick · enter resume · n new · esc close"
        width={panelW}
      >
        <box marginTop={1} flexDirection="column">
          {!loaded && <text fg={theme.textMuted}>loading sessions...</text>}
          {loaded && shown.length === 0 && (
            <text fg={theme.textMuted}>
              no sessions found — press <span fg={theme.accent}>n</span> to start fresh.
            </text>
          )}
          {shown.map((s, i) => {
            const active = s.id === activeSessionId;
            const highlighted = i === clamped;
            const fg = highlighted ? theme.bg : active ? theme.accent : theme.text;
            const bg = highlighted ? theme.accent : "transparent";
            const star = active ? "●" : "○";
            const preview = (s.title ?? s.first_user_message ?? "(empty)")
              .replace(/\s+/g, " ").slice(0, 50);
            const meta = `${s.total_messages}m · ${s.turn_count}t · ${fmtTokens(s.token_count)}tk`;
            const ago = relativeTime(s.last_activity);
            return (
              <box key={s.id} flexDirection="column">
                <text fg={fg} bg={bg}>
                  {` ${star} ${preview.padEnd(50, " ")} ${meta} · ${ago} `}
                </text>
              </box>
            );
          })}
        </box>
      </OverlayPanel>
    </OverlayHost>
  );
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}

function relativeTime(isoOrTs: string): string {
  const ms = Date.now() - new Date(isoOrTs).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}
