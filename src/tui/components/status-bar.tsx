import React from "react";
import { theme } from "../theme.ts";
import type { UiState } from "../store-reducer.ts";

interface Props {
  state: UiState;
  workspace: string;
  connectionState: string;
}

export function StatusBar({ state, workspace, connectionState }: Props) {
  const status = sessionStatus(state, connectionState);
  return (
    <box flexDirection="row" height={1} backgroundColor={theme.bgAccent} paddingX={1}>
      <text fg={theme.accent}><strong>glorp</strong></text>
      <text fg={theme.textDim}> </text>
      <text fg={status.color}>{status.icon} {status.label}</text>
      {state.title && (
        <>
          <text fg={theme.textDim}> · </text>
          <text fg={theme.text}>{truncate(state.title, 40)}</text>
        </>
      )}
      <box flexGrow={1} />
      {state.modelLabel && (
        <text fg={theme.textMuted}>{truncate(state.modelLabel, 24)} </text>
      )}
      <text fg={theme.textDim}>· </text>
      <text fg={contextColor(state.stats.contextPct)}>
        ctx {state.stats.contextPct}%
      </text>
    </box>
  );
}

function sessionStatus(
  state: UiState,
  connectionState: string,
): { label: string; color: string; icon: string } {
  if (connectionState !== "connected") {
    return { label: connectionState, color: theme.error, icon: "◌" };
  }
  if (state.lastError) return { label: "Error", color: theme.error, icon: "✗" };
  if (state.loopPhase === "generating") return { label: "Generating", color: theme.loopActive, icon: "⚡" };
  if (state.loopPhase === "evaluating") return { label: "Evaluating", color: theme.loopActive, icon: "⏳" };
  if (state.compacting) return { label: "Compacting", color: theme.warning, icon: "◈" };
  if (state.activeSubagents.length > 0) return { label: "Agents", color: theme.warning, icon: "●" };
  if (state.busy && state.streamingText) return { label: "Responding", color: theme.accent, icon: "◉" };
  if (state.busy) return { label: "Working", color: theme.warning, icon: "●" };
  return { label: "Ready", color: theme.success, icon: "○" };
}

function contextColor(pct: number): string {
  if (pct >= 85) return theme.error;
  if (pct >= 65) return theme.warning;
  return theme.success;
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1) + "…";
}
