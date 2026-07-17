/**
 * MCP servers overlay — every server from the `mcp` section of glorp.json,
 * with live connection state and bridged tool counts. Opened via Ctrl+E or
 * `/mcp`. Enter toggles a server on/off (the agent is rebuilt so the tool set
 * actually matches). Data comes from `state.mcpServers` (mcp_status events),
 * so a toggle refreshes the list live once the rebuild finishes.
 */

import React from "react";
import { useTerminalDimensions } from "@opentui/react";
import { theme } from "./theme.ts";
import { OverlayHost, OverlayPanel } from "./overlay-host.tsx";
import { MenuList, type MenuItem } from "./components/menu/menu-list.tsx";
import type { McpServerStatus } from "../shared/events.ts";
import type { UiState } from "./store-reducer.ts";
import type { GlorpClient } from "../client/client.ts";

interface Props {
  client: GlorpClient;
  state: UiState;
  onClose: () => void;
}

export function McpPanel({ client, state, onClose }: Props) {
  const { width, height } = useTerminalDimensions();
  const servers = state.mcpServers;
  const panelW = Math.min(92, Math.max(56, width - 8));
  const listW = panelW - 4;
  const connected = servers.filter((s) => s.state === "connected").length;
  const toolTotal = servers.reduce((n, s) => n + s.toolCount, 0);

  const items: MenuItem[] = servers.map(toItem);

  function toggle(item: MenuItem | null) {
    if (!item) return;
    const server = servers.find((s) => s.id === item.id);
    if (server) client.setMcpServer(server.id, !server.active);
  }

  return (
    <OverlayHost width={width} height={height}>
      <OverlayPanel
        title="mcp servers"
        titleColor={theme.transmission}
        subtitle={servers.length === 0
          ? undefined
          : `${connected}/${servers.length} connected · ${toolTotal} tools · enter toggles (rebuilds agent)`}
        borderColor={theme.transmission}
        width={panelW}
      >
        <MenuList
          items={items}
          width={listW}
          placeholder="filter servers…"
          accentColor={theme.transmission}
          emptyText={'no MCP servers configured — add an "mcp" section to glorp.json (see docs/mcp-servers.md)'}
          onSubmit={(item) => toggle(item)}
          onClose={onClose}
          actions={[{ key: "t", label: "toggle", run: toggle }]}
        />
      </OverlayPanel>
    </OverlayHost>
  );
}

function toItem(s: McpServerStatus): MenuItem {
  const parts: string[] = [];
  if (s.state === "connected") parts.push(`${s.toolCount} tool${s.toolCount === 1 ? "" : "s"}`);
  if (s.state === "error") parts.push(`error: ${clip(s.error ?? "connect failed", 40)}`);
  if (s.state === "inactive") parts.push(s.active ? "activating…" : "off");
  parts.push(clip(s.url, 36));
  return {
    id: s.id,
    label: s.name,
    icon: stateGlyph(s),
    detail: parts.join(" · "),
    hint: s.description ? clip(s.description, 44) : undefined,
    accent: stateColor(s),
    keywords: [s.id, s.url, ...(s.tags ?? []), ...(s.tools ?? [])],
  };
}

function stateGlyph(s: McpServerStatus): string {
  if (s.state === "connected") return "●";
  if (s.state === "error") return "✗";
  return s.active ? "◌" : "○";
}

function stateColor(s: McpServerStatus): string | undefined {
  if (s.state === "connected") return theme.success;
  if (s.state === "error") return theme.error;
  return undefined;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}
