import React, { useMemo } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { theme } from "./theme.ts";
import { OverlayHost, OverlayPanel } from "./overlay-host.tsx";
import { MenuList, type MenuItem } from "./components/menu/menu-list.tsx";

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;        // appended dim text after label
  detail?: string;      // right-aligned dim (e.g. a keybind like "^A")
  group?: string;       // section header, e.g. "Agents", "Session", "View"
  keywords?: string[];  // extra fuzzy terms
  icon?: string;        // single glyph
  run: () => void;      // executed on Enter
}

interface Props {
  commands: PaletteCommand[];
  onClose: () => void;
}

/**
 * Helix-editor-style unified command palette: a centered modal with a fuzzy
 * filter input and a scrollable, grouped list of every command in the app.
 *
 * Reuses the shared MenuList primitive for filtering, navigation, scrolling
 * and footer rendering — this component only maps commands to menu items,
 * orders them by group, and wires submit/close into the overlay chrome.
 */
export function CommandPalette({ commands, onClose }: Props): React.ReactElement {
  const { width, height } = useTerminalDimensions();
  const panelW = Math.min(86, Math.max(56, width - 8));

  const items = useMemo<MenuItem[]>(
    () =>
      orderByGroup(commands).map((c) => ({
        id: c.id,
        label: c.label,
        hint: c.hint,
        detail: c.detail,
        group: c.group,
        keywords: c.keywords,
        icon: c.icon,
      })),
    [commands],
  );

  const tree = (
    <OverlayHost width={width} height={height}>
      <OverlayPanel
        title="commands"
        titleColor={theme.accent}
        subtitle={`${commands.length} actions`}
        width={panelW}
      >
        <MenuList
          items={items}
          width={panelW - 4}
          placeholder="search commands…"
          accentColor={theme.accent}
          maxVisible={12}
          onSubmit={(item) => {
            const cmd = commands.find((c) => c.id === item.id);
            onClose();
            cmd?.run();
          }}
          onClose={onClose}
        />
      </OverlayPanel>
    </OverlayHost>
  );
  return tree as React.ReactElement;
}

/**
 * Stable group ordering: collects commands into the order their groups first
 * appear, preserving the given order within each group, so MenuList's
 * consecutive-group headers render coherently.
 */
function orderByGroup(commands: PaletteCommand[]): PaletteCommand[] {
  const groups: string[] = [];
  const buckets = new Map<string, PaletteCommand[]>();
  for (const c of commands) {
    const key = c.group ?? "";
    if (!buckets.has(key)) {
      buckets.set(key, []);
      groups.push(key);
    }
    buckets.get(key)!.push(c);
  }
  const ordered: PaletteCommand[] = [];
  for (const key of groups) ordered.push(...buckets.get(key)!);
  return ordered;
}
