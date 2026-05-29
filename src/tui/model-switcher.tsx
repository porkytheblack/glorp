import React, { useMemo, useState } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { theme } from "./theme.ts";
import { OverlayHost, OverlayPanel } from "./overlay-host.tsx";
import { MenuList, type MenuItem } from "./components/menu/menu-list.tsx";
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
 * Model switcher overlay. Fetches the profile list from the server via REST and
 * hands selection back through `onPick`. Built on the shared MenuList primitive
 * for fuzzy filtering, keyboard nav, scrolling, and footer hints.
 */
export function ModelSwitcher({ client, activeProfileId, onPick, onClose }: Props) {
  const { width, height } = useTerminalDimensions();
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
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

  const items = useMemo<MenuItem[]>(() => profiles.map((p) => {
    const active = p.id === activeProfileId;
    return {
      id: p.id,
      label: p.label,
      icon: active ? "●" : "○",
      detail: [p.reasoningLabel, p.contextLabel].filter(Boolean).join(" · "),
      accent: active ? theme.accent : undefined,
      keywords: [p.provider_id, p.model],
    };
  }), [profiles, activeProfileId]);

  const panelW = Math.min(86, Math.max(56, width - 8));
  const innerW = panelW - 4;

  return (
    <OverlayHost width={width} height={height}>
      <OverlayPanel
        title="switch model"
        titleColor={theme.accent}
        subtitle={loaded ? `${profiles.length} profiles` : undefined}
        width={panelW}
      >
        <box marginTop={1} flexDirection="column">
          {!loaded ? (
            <text fg={theme.textMuted}>loading profiles…</text>
          ) : (
            <MenuList
              items={items}
              onSubmit={(item) => onPick(item.id)}
              onClose={onClose}
              width={innerW}
              placeholder="search models…"
              accentColor={theme.accent}
              emptyText="no profiles configured"
            />
          )}
        </box>
      </OverlayPanel>
    </OverlayHost>
  );
}
