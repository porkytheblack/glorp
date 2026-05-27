import React, { useMemo, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { theme } from "./theme.ts";
import { OverlayHost, OverlayPanel } from "./overlay-host.tsx";
import type { GlorpClient } from "../client/client.ts";

interface ProfileInfo {
  id: string;
  label: string;
  provider_id: string;
  model: string;
  contextLabel?: string;
  reasoningLabel?: string;
}

interface Props {
  client: GlorpClient;
  activeProfileId?: string;
  onPick: (profileId: string) => void;
  onClose: () => void;
}

/**
 * Model switcher overlay adapted for the client TUI. Fetches profile list
 * from the server via REST, and sends swap_profile commands over WebSocket.
 *
 * Keys: enter = switch, esc = close, up/down = navigate.
 */
export function ModelSwitcher({ client, activeProfileId, onPick, onClose }: Props) {
  const { width, height } = useTerminalDimensions();
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useMemo(() => {
    client.listProfiles()
      .then((res) => {
        const list = (res as { profiles: ProfileInfo[] }).profiles ?? [];
        setProfiles(list);
        setLoaded(true);
      })
      .catch(() => { setLoaded(true); });
  }, [client]);

  const clamped = Math.min(cursor, Math.max(0, profiles.length - 1));

  useKeyboard((key) => {
    if (key.name === "escape") return onClose();
    if (profiles.length === 0) return;
    if (key.name === "up" || key.name === "k") {
      setCursor((c) => Math.max(0, c - 1)); return;
    }
    if (key.name === "down" || key.name === "j") {
      setCursor((c) => Math.min(profiles.length - 1, c + 1)); return;
    }
    if (key.name === "return") {
      const p = profiles[clamped];
      if (p) onPick(p.id);
    }
  });

  const panelW = Math.min(86, Math.max(56, width - 8));

  return (
    <OverlayHost width={width} height={height}>
      <OverlayPanel
        title="switch model"
        titleColor={theme.accent}
        hint="up/down pick · enter switch · esc close"
        width={panelW}
      >
        <box marginTop={1} flexDirection="column">
          {!loaded && <text fg={theme.textMuted}>loading profiles...</text>}
          {loaded && profiles.length === 0 && (
            <text fg={theme.textMuted}>no profiles configured on the server.</text>
          )}
          {profiles.map((p, i) => {
            const active = p.id === activeProfileId;
            const highlighted = i === clamped;
            const fg = highlighted ? theme.bg : active ? theme.accent : theme.text;
            const bg = highlighted ? theme.accent : "transparent";
            const star = active ? "● " : "  ";
            const extras = [
              p.reasoningLabel,
              p.contextLabel,
            ].filter(Boolean).join(" · ");
            return (
              <box key={p.id} flexDirection="column">
                <text fg={fg} bg={bg}>
                  {` ${star}${p.label}${extras ? ` · ${extras}` : ""} `}
                </text>
              </box>
            );
          })}
        </box>
      </OverlayPanel>
    </OverlayHost>
  );
}
