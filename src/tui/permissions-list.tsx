import React, { useEffect, useMemo, useState } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { theme } from "./theme.ts";
import { OverlayHost, OverlayPanel } from "./overlay-host.tsx";
import { MenuList, type MenuItem } from "./components/menu/menu-list.tsx";
import type { GlorpClient } from "../client/client.ts";

interface PermRow {
  key: string;
  tool: string;
  projection: string;
  status: "granted" | "denied" | "unset";
}

interface Props {
  client: GlorpClient;
  onClose: () => void;
}

/**
 * Permissions list overlay. Persisted grants live in server state since the TUI
 * is a remote client, so we resync on open. Revocations are sent as commands
 * through the client and reflected locally so the list updates instantly.
 */
export function PermissionsList({ client, onClose }: Props) {
  const { width, height } = useTerminalDimensions();
  const [rows, setRows] = useState<PermRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    client.resync();
    setLoaded(true);
  }, [client]);

  const items = useMemo<MenuItem[]>(
    () => rows.map((row) => ({
      id: row.key,
      label: row.key,
      icon: statusGlyph(row.status),
      detail: row.status,
      accent: statusColor(row.status),
      keywords: [row.tool, row.projection],
    })),
    [rows],
  );

  function revoke(item: MenuItem | null) {
    if (!item) return;
    const row = rows.find((r) => r.key === item.id);
    if (!row) return;
    client.clearPermissionKey(row.key);
    setRows((prev) => prev.filter((r) => r.key !== row.key));
  }

  const panelW = Math.min(86, Math.max(56, width - 8));
  const innerW = panelW - 4;
  const emptyText = loaded
    ? "no saved permissions — tools will prompt on first use"
    : "loading…";

  return (
    <OverlayHost width={width} height={height}>
      <OverlayPanel
        title="permissions"
        subtitle={loaded ? `${rows.length} saved` : undefined}
        width={panelW}
      >
        <box marginTop={1} flexDirection="column">
          <MenuList
            items={items}
            onSubmit={() => { /* read-only; revoke is the explicit `d` action */ }}
            onClose={onClose}
            width={innerW}
            placeholder="search permissions…"
            emptyText={emptyText}
            actions={[{ key: "d", label: "revoke", run: revoke }]}
          />
        </box>
      </OverlayPanel>
    </OverlayHost>
  );
}

function statusColor(s: string): string {
  if (s === "granted") return theme.success;
  if (s === "denied") return theme.error;
  return theme.textMuted;
}

function statusGlyph(s: string): string {
  if (s === "granted") return "✓";
  if (s === "denied") return "✗";
  return "○";
}
