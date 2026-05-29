import React, { useMemo } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { theme } from "./theme.ts";
import { KEYBINDS, type Keybind } from "./keybinds.ts";
import { OverlayHost, OverlayPanel } from "./overlay-host.tsx";
import { MenuList, type MenuItem } from "./components/menu/menu-list.tsx";

interface Props {
  onClose: () => void;
}

const GROUPS: Array<{ context: Keybind["context"]; label: string }> = [
  { context: "global", label: "global" },
  { context: "input", label: "input" },
  { context: "permission", label: "permissions" },
  { context: "overlay", label: "overlays" },
];

/**
 * Help overlay — a grouped, searchable keybinding reference. Built on the shared
 * MenuList primitive (read-only) so search, scroll, and Esc-to-close come free.
 */
export function HelpDialog({ onClose }: Props) {
  const { width, height } = useTerminalDimensions();

  const items = useMemo<MenuItem[]>(
    () => GROUPS.flatMap(({ context, label }) =>
      KEYBINDS.filter((kb) => kb.context === context).map((kb, i) => ({
        id: `${context}-${kb.key}-${i}`,
        label: kb.description,
        detail: kb.label,
        group: label,
        keywords: [kb.key, kb.label],
      })),
    ),
    [],
  );

  const panelW = Math.min(80, Math.max(56, width - 8));
  const innerW = panelW - 4;

  return (
    <OverlayHost width={width} height={height}>
      <OverlayPanel title="help" subtitle="keybindings" width={panelW}>
        <box marginTop={1} flexDirection="column">
          <MenuList
            items={items}
            onSubmit={() => { /* reference only */ }}
            onClose={onClose}
            width={innerW}
            placeholder="search shortcuts…"
            maxVisible={16}
            emptyText="no shortcuts"
            footerHint="type to filter · esc close"
          />
        </box>
      </OverlayPanel>
    </OverlayHost>
  );
}
