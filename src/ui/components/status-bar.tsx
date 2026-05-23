import React from "react";
import { theme } from "../theme.ts";
import type { UiState } from "../store.ts";
import { GLORP_VERSION } from "../../shared/version.ts";

export function StatusBar({
  state,
  workspace,
  model,
}: {
  state: UiState;
  workspace: string;
  model: string;
}) {
  const pct = state.stats.contextPct;
  const pctColor = pct > 85 ? theme.error : pct > 65 ? theme.warning : theme.textMuted;
  return (
    <box flexDirection="row" padding={0} paddingX={1} height={1} backgroundColor={theme.bgAccent}>
      <text fg={theme.accent}>
        <strong>glorp</strong>
      </text>
      <text fg={theme.textDim}> v{GLORP_VERSION} </text>
      <text fg={theme.textMuted}>· {model} </text>
      <text fg={theme.textDim}>· </text>
      <text fg={theme.textMuted}>{truncatePath(workspace)} </text>
      <text fg={theme.textDim}>· </text>
      <text fg={pctColor}>ctx {pct}%</text>
      <text fg={theme.textDim}> · </text>
      <text fg={theme.textMuted}>{state.stats.turns} turns</text>
      <text fg={theme.textDim}> · </text>
      <text fg={theme.textMuted}>{state.stats.tokens_in.toLocaleString()} tok</text>
      {state.lastError && (
        <>
          <text fg={theme.textDim}> · </text>
          <text fg={theme.error}>err: {state.lastError.slice(0, 60)}</text>
        </>
      )}
    </box>
  );
}

function truncatePath(p: string, max = 38): string {
  if (p.length <= max) return p;
  const parts = p.split("/");
  if (parts.length <= 2) return "…" + p.slice(-(max - 1));
  return ".../" + parts.slice(-2).join("/");
}
