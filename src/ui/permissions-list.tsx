import React, { useEffect, useMemo, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { PermissionStatus } from "glove-core/core";
import type { GlorpStore } from "../agent/store.ts";
import { theme } from "./theme.ts";

interface Props {
  store: GlorpStore;
  /** Clears every grant whose canonical key belongs to `toolName`. */
  onClearAllForTool: (toolName: string) => Promise<void>;
  /** Surgically removes one canonical key (e.g. `bash:git`). */
  onClearKey: (key: string) => Promise<void>;
  onClose: () => void;
}

interface Row {
  key: string;
  tool: string;
  projection: string;
  status: PermissionStatus;
}

/**
 * Ctrl+P overlay. As of glove-core 3.0.6, permissions are keyed by
 * (tool, canonical projection) — see `canonicalPermissionKey`. The list
 * shows every persisted grant rather than a fixed tool list.
 *
 *   ↑ ↓ / k j  — move
 *   r          — revoke focused row
 *   R          — revoke all rows for the focused tool
 *   esc        — close
 */
export function PermissionsList({ store, onClearAllForTool, onClearKey, onClose }: Props) {
  const { width, height } = useTerminalDimensions();
  const [tick, setTick] = useState(0);
  const [cursor, setCursor] = useState(0);

  const rows = useMemo<Row[]>(() => {
    return store.listPermissions().map((entry) => {
      const [tool, ...rest] = entry.key.split(":");
      return {
        key: entry.key,
        tool: tool ?? entry.key,
        projection: rest.join(":") || "*",
        status: entry.status,
      };
    });
  }, [store, tick]);

  useEffect(() => {
    if (cursor >= rows.length) setCursor(Math.max(0, rows.length - 1));
  }, [rows.length, cursor]);

  useKeyboard((key) => {
    if (key.name === "escape") return onClose();
    if (rows.length === 0) return;
    if (key.name === "up" || key.name === "k") {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.name === "down" || key.name === "j") {
      setCursor((c) => Math.min(rows.length - 1, c + 1));
      return;
    }
    if (key.sequence === "R") {
      const row = rows[cursor];
      if (!row) return;
      void onClearAllForTool(row.tool).then(() => setTick((t) => t + 1));
      return;
    }
    if (key.name === "r") {
      const row = rows[cursor];
      if (!row) return;
      void onClearKey(row.key).then(() => setTick((t) => t + 1));
    }
  });

  const panelW = Math.min(96, Math.max(60, width - 8));
  const colKey = Math.max(20, panelW - 22);

  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={theme.bg}
      justifyContent="center"
      alignItems="center"
    >
      <box
        flexDirection="column"
        width={panelW}
        border
        borderStyle="rounded"
        borderColor={theme.borderActive}
        backgroundColor={theme.bgPanel}
        padding={1}
      >
        <text fg={theme.accent}>
          <strong>permissions</strong>
        </text>
        <text fg={theme.textDim}>↑↓ pick · r revoke key · R revoke all for tool · esc close</text>
        <box marginTop={1} flexDirection="column">
          {rows.length === 0 ? (
            <text fg={theme.textMuted}>no persisted grants. tools will prompt on first use.</text>
          ) : (
            rows.map((row, i) => {
              const highlighted = i === cursor;
              const fg = highlighted ? theme.bg : statusColor(row.status);
              const bg = highlighted ? statusColor(row.status) : "transparent";
              const display = ` ${statusGlyph(row.status)} ${truncate(row.key, colKey).padEnd(colKey, " ")}  ${row.status.padEnd(8, " ")} `;
              return <text key={row.key} fg={fg} bg={bg}>{display}</text>;
            })
          )}
        </box>
        <box marginTop={1}>
          <text fg={theme.textMuted}>
            keys are tool:projection — e.g. <span fg={theme.toolName}>bash:git</span>,{" "}
            <span fg={theme.toolName}>edit:src/foo.ts</span>. read-only bash commands are never gated.
          </text>
        </box>
      </box>
    </box>
  );
}

function statusColor(s: PermissionStatus): string {
  switch (s) {
    case "granted":
      return theme.success;
    case "denied":
      return theme.error;
    case "unset":
      return theme.textMuted;
  }
}

function statusGlyph(s: PermissionStatus): string {
  switch (s) {
    case "granted":
      return "✓";
    case "denied":
      return "✗";
    case "unset":
      return "○";
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}
