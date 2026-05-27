/**
 * Agent manager overlay — lists running agents, lets you promote
 * one to foreground or stop it. Opened via Ctrl+A.
 */

import React, { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { theme } from "./theme.ts";
import { OverlayHost, OverlayPanel } from "./overlay-host.tsx";
import type { UiState } from "./store-reducer.ts";
import type { GlorpClient } from "../client/client.ts";

interface AgentRow {
  id: string;
  label: string;
  role: string;
  isForeground: boolean;
  interrupted: boolean;
  source: "orchestrator" | "subagent";
}

interface Props {
  client: GlorpClient;
  state: UiState;
  onClose: () => void;
}

export function AgentManager({ client, state, onClose }: Props) {
  const { width, height } = useTerminalDimensions();
  const [cursor, setCursor] = useState(0);

  const rows = buildAgentRows(state);
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
    if (key.name === "p" || key.name === "return") {
      const row = rows[clamped];
      if (row && !row.isForeground && !row.interrupted) client.promoteAgent(row.id);
      return;
    }
    if (key.name === "x" || key.name === "d") {
      const row = rows[clamped];
      if (row && !row.interrupted) {
        client.stopAgent(row.id, "stopped from agent manager");
        setCursor((c) => Math.max(0, c - 1));
      }
    }
  });

  const panelW = Math.min(86, Math.max(50, width - 8));

  return (
    <OverlayHost width={width} height={height}>
      <OverlayPanel
        title="agents"
        titleColor={theme.agent}
        hint="up/down pick · p promote · x stop · esc close"
        borderColor={theme.agent}
        width={panelW}
      >
        <box marginTop={1} flexDirection="column">
          {rows.length === 0 ? (
            <text fg={theme.textMuted}>
              no agents running. use{" "}
              <span fg={theme.accent}>/build</span> or let the agent spawn them.
            </text>
          ) : (
            rows.map((row, i) => {
              const highlighted = i === clamped;
              const fg = highlighted ? theme.bg : row.interrupted ? theme.textMuted : row.isForeground ? theme.accent : theme.text;
              const bg = highlighted ? theme.agent : "transparent";
              const star = row.isForeground ? "★" : row.interrupted ? "✕" : "○";
              const slot = row.interrupted ? "int" : row.isForeground ? "fg" : "bg";
              const display = ` ${star} ${clip(row.label, panelW - 28).padEnd(panelW - 28)} `
                + `${row.role.padEnd(12)}${slot} `;
              return <text key={row.id} fg={fg} bg={bg}>{display}</text>;
            })
          )}
        </box>
        {rows.length > 0 && (
          <box marginTop={1}>
            <text fg={theme.textMuted}>
              {rows.length} agent{rows.length !== 1 ? "s" : ""}{" · "}
              <span fg={theme.accent}>★</span> fg{" · "}✕ interrupted
            </text>
          </box>
        )}
      </OverlayPanel>
    </OverlayHost>
  );
}

function buildAgentRows(state: UiState): AgentRow[] {
  const rows: AgentRow[] = [];
  for (const a of state.orchestratorAgents) {
    if (a.action !== "spawned" && a.action !== "interrupted") continue;
    rows.push({
      id: a.id, label: a.label, role: a.role ?? "agent",
      isForeground: state.foregroundAgent === a.id,
      interrupted: a.action === "interrupted",
      source: "orchestrator",
    });
  }
  for (const name of state.activeSubagents) {
    if (rows.some((r) => r.label === name)) continue;
    rows.push({
      id: `sub_${name}`, label: name, role: "subagent",
      isForeground: false, interrupted: false, source: "subagent",
    });
  }
  // Foreground first, then active, then interrupted last.
  return rows.sort((a, b) => {
    if (a.isForeground !== b.isForeground) return a.isForeground ? -1 : 1;
    if (a.interrupted !== b.interrupted) return a.interrupted ? 1 : -1;
    return 0;
  });
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(1, max - 1)) + "…";
}
