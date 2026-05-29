import React, { useMemo } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { theme } from "./theme.ts";
import { OverlayHost, OverlayPanel } from "./overlay-host.tsx";
import { MenuList, type MenuItem } from "./components/menu/menu-list.tsx";
import type { UiState } from "./store-reducer.ts";

type Severity = "low" | "medium" | "high";

interface Props {
  transmissions: UiState["transmissions"];
  onClose: () => void;
}

const GLYPHS: Record<Severity, string> = { low: "◇", medium: "◈", high: "◆" };
const COLORS: Record<Severity, string> = {
  low: theme.textMuted,
  medium: theme.transmission,
  high: theme.transmissionHigh,
};

/**
 * Read-only, searchable signals log. Built on the shared MenuList primitive for
 * fuzzy filtering and keyboard nav; newest entries are shown first.
 */
export function TransmissionsLog({ transmissions, onClose }: Props) {
  const { width, height } = useTerminalDimensions();

  const items = useMemo<MenuItem[]>(
    () => [...transmissions].reverse().map((e, i) => ({
      id: `${e.at}-${i}`,
      label: e.payload.replace(/\s+/g, " "),
      icon: GLYPHS[e.severity],
      detail: `${e.severity} · ${relativeMs(e.at)}`,
      accent: COLORS[e.severity],
    })),
    [transmissions],
  );

  const panelW = Math.min(100, Math.max(56, width - 6));
  const innerW = panelW - 4;

  return (
    <OverlayHost width={width} height={height}>
      <OverlayPanel
        title="signals log"
        titleColor={theme.transmission}
        subtitle={`${transmissions.length} entr${transmissions.length === 1 ? "y" : "ies"}`}
        borderColor={theme.transmission}
        width={panelW}
      >
        <box marginTop={1} flexDirection="column">
          <MenuList
            items={items}
            onSubmit={() => { /* read-only log */ }}
            onClose={onClose}
            width={innerW}
            accentColor={theme.transmission}
            placeholder="search signals…"
            emptyText="no signals yet"
          />
        </box>
      </OverlayPanel>
    </OverlayHost>
  );
}

function relativeMs(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}
