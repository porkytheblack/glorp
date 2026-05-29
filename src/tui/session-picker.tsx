import React, { useEffect, useMemo, useState } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { theme } from "./theme.ts";
import { OverlayHost, OverlayPanel } from "./overlay-host.tsx";
import { MenuList, type MenuItem } from "./components/menu/menu-list.tsx";
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

/**
 * Session picker overlay. Fetches recent sessions via REST and resumes the
 * chosen one through `onPick`; `n` starts a fresh session via `onNew`. Built on
 * the shared MenuList primitive for fuzzy filtering, keyboard nav, and scroll.
 */
export function SessionPicker({ client, activeSessionId, workspace, onPick, onNew, onClose }: Props) {
  const { width, height } = useTerminalDimensions();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    client.listSessions(workspace, LIST_LIMIT)
      .then((res) => {
        setSessions((res as { sessions: SessionInfo[] }).sessions ?? []);
        setLoaded(true);
      })
      .catch(() => { setLoaded(true); });
  }, [client, workspace]);

  const items = useMemo<MenuItem[]>(() => sessions.slice(0, LIST_LIMIT).map((s) => {
    const active = s.id === activeSessionId;
    const label = (s.title ?? s.first_user_message ?? "(empty)").replace(/\s+/g, " ");
    const meta = `${s.total_messages}m · ${fmtTokens(s.token_count)}tk`;
    return {
      id: s.id,
      label,
      icon: active ? "●" : "○",
      detail: `${meta} · ${relativeTime(s.last_activity)}`,
      accent: active ? theme.accent : undefined,
    };
  }), [sessions, activeSessionId]);

  const panelW = Math.min(96, Math.max(60, width - 8));
  const innerW = panelW - 4;

  return (
    <OverlayHost width={width} height={height}>
      <OverlayPanel
        title="sessions"
        titleColor={theme.accent}
        subtitle={loaded ? `${sessions.length} recent` : undefined}
        width={panelW}
      >
        <box marginTop={1} flexDirection="column">
          {!loaded ? (
            <text fg={theme.textMuted}>loading sessions…</text>
          ) : (
            <MenuList
              items={items}
              onSubmit={(item) => onPick(item.id)}
              onClose={onClose}
              width={innerW}
              placeholder="search sessions…"
              accentColor={theme.accent}
              actions={[{ key: "n", label: "new session", run: () => onNew() }]}
              emptyText="no sessions found — n to start fresh"
            />
          )}
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
