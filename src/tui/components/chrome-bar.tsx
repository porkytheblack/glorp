import React from "react";
import { theme } from "../theme.ts";

interface Props {
  modelLabel: string;
  contextPct: number;
  peerCount: number;
  width: number;
  permissionMode: "normal" | "auto" | "bypass";
}

const MODE_DISPLAY: Record<string, { label: string; color: string }> = {
  normal: { label: "normal", color: theme.textMuted },
  auto:   { label: "auto",   color: theme.warning },
  bypass: { label: "bypass", color: theme.error },
};

export function ChromeBar({ modelLabel, contextPct, peerCount, width, permissionMode }: Props) {
  const pctColor = contextPct >= 85 ? theme.error : contextPct >= 65 ? theme.warning : theme.success;
  const mode = MODE_DISPLAY[permissionMode] ?? MODE_DISPLAY.normal;
  return (
    <box flexDirection="row" height={1} backgroundColor={theme.bgAccent} paddingX={1} width={width}>
      <text fg={theme.textMuted}>{truncate(modelLabel || "no model", 20)}</text>
      <text fg={theme.textDim}> · </text>
      <text fg={pctColor}>ctx {contextPct}%</text>
      {peerCount > 1 && (
        <>
          <text fg={theme.textDim}> · </text>
          <text fg={theme.agent}>{peerCount} peers</text>
        </>
      )}
      <box flexGrow={1} />
      <text fg={theme.textDim}>
        <span fg={theme.text}>^?</span> help
        <span fg={theme.textDim}> · </span>
        <span fg={theme.text}>^A</span> agents
        <span fg={theme.textDim}> · </span>
        <span fg={theme.text}>^M</span> model
        <span fg={theme.textDim}> · </span>
        <span fg={theme.text}>^E</span> mcp
        <span fg={theme.textDim}> · </span>
        <span fg={theme.text}>^R</span> reasoning
        <span fg={theme.textDim}> · </span>
        <span fg={theme.text}>^B</span> rail
        <span fg={theme.textDim}> · </span>
        <span fg={theme.text}>^Y</span> <span fg={mode.color}>{mode.label}</span>
        <span fg={theme.textDim}> · </span>
        <span fg={theme.text}>^V</span> paste img
      </text>
    </box>
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
