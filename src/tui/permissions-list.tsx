import React, { useEffect, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { theme } from "./theme.ts";
import { OverlayHost, OverlayPanel } from "./overlay-host.tsx";
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
 * Permissions list overlay. Fetched from server state since the TUI
 * is a remote client. Revocations are sent as commands through the client.
 */
export function PermissionsList({ client, onClose }: Props) {
  const { width, height } = useTerminalDimensions();
  const [rows, setRows] = useState<PermRow[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    client.resync();
    setLoaded(true);
  }, [client]);

  const clamped = Math.min(cursor, Math.max(0, rows.length - 1));

  useKeyboard((key) => {
    if (key.name === "escape") return onClose();
    if (rows.length === 0) return;
    if (key.name === "up" || key.name === "k") {
      setCursor((c) => Math.max(0, c - 1)); return;
    }
    if (key.name === "down" || key.name === "j") {
      setCursor((c) => Math.min(rows.length - 1, c + 1)); return;
    }
    if (key.sequence === "R") {
      const row = rows[clamped];
      if (row) {
        client.clearPermission(row.tool);
        setRows((prev) => prev.filter((r) => r.tool !== row.tool));
      }
      return;
    }
    if (key.name === "r") {
      const row = rows[clamped];
      if (row) {
        client.clearPermissionKey(row.key);
        setRows((prev) => prev.filter((r) => r.key !== row.key));
      }
    }
  });

  const panelW = Math.min(86, Math.max(56, width - 8));
  const colKey = Math.max(20, panelW - 22);

  return (
    <OverlayHost width={width} height={height}>
      <OverlayPanel
        title="permissions"
        hint="up/down pick · r revoke key · R revoke all for tool · esc close"
        width={panelW}
      >
        <box marginTop={1} flexDirection="column">
          {rows.length === 0 ? (
            <text fg={theme.textMuted}>
              {loaded ? "no persisted grants. tools will prompt on first use." : "loading..."}
            </text>
          ) : (
            rows.map((row, i) => {
              const highlighted = i === clamped;
              const fg = highlighted ? theme.bg : statusColor(row.status);
              const bg = highlighted ? statusColor(row.status) : "transparent";
              const display = ` ${statusGlyph(row.status)} ${clip(row.key, colKey).padEnd(colKey, " ")}  ${row.status.padEnd(8, " ")} `;
              return <text key={row.key} fg={fg} bg={bg}>{display}</text>;
            })
          )}
        </box>
        <box marginTop={1}>
          <text fg={theme.textMuted}>
            keys are tool:projection — e.g.{" "}
            <span fg={theme.toolName}>bash:git</span>,{" "}
            <span fg={theme.toolName}>edit:src/foo.ts</span>
          </text>
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

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)) + "…";
}
