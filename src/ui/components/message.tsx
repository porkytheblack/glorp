import React from "react";
import type { ChatTurn } from "../../shared/events.ts";
import { theme } from "../theme.ts";
import { ToolCallRow } from "./tool-call.tsx";
import { isOrchestratorTurn, OrchestratorRow } from "./orchestrator-row.tsx";
import { ReasoningRow } from "./reasoning-row.tsx";

const LABEL: Record<ChatTurn["kind"], string> = {
  user: "you",
  agent: "glorp",
  tool: "tool",
  system: "sys",
  transmission: "tx",
};

const LABEL_COLOR: Record<ChatTurn["kind"], string> = {
  user: theme.user,
  agent: theme.accent,
  tool: theme.toolName,
  system: theme.system,
  transmission: theme.transmission,
};

export function MessageRow({ turn, showReasoning }: { turn: ChatTurn; showReasoning?: boolean }) {
  if (isOrchestratorTurn(turn)) return <OrchestratorRow turn={turn} />;
  if (turn.kind === "tool" && turn.tool) {
    return (
      <box flexDirection="row" marginBottom={0}>
        <box width={6} marginRight={1}>
          <text fg={LABEL_COLOR[turn.kind]}>
            <strong>{LABEL[turn.kind]}</strong>
          </text>
        </box>
        <box flexDirection="column" flexGrow={1}>
          <ToolCallRow tool={turn.tool} />
        </box>
      </box>
    );
  }
  const text = turn.text ?? "";
  return (
    <box flexDirection="row" marginBottom={1}>
      <box width={6} marginRight={1}>
        <text fg={LABEL_COLOR[turn.kind]}>
          <strong>{LABEL[turn.kind]}</strong>
        </text>
      </box>
      <box flexDirection="column" flexGrow={1}>
        {showReasoning && turn.reasoning && <ReasoningRow text={turn.reasoning} />}
        {text.split("\n").map((line, i) => (
          <text key={i} fg={turn.kind === "system" ? theme.textMuted : theme.text}>
            {line || " "}
          </text>
        ))}
      </box>
    </box>
  );
}

export function StreamingRow({ text }: { text: string }) {
  if (!text) return null;
  return (
    <box flexDirection="row" marginBottom={1}>
      <box width={6} marginRight={1}>
        <text fg={theme.accent}>
          <strong>glorp</strong>
        </text>
      </box>
      <box flexDirection="column" flexGrow={1}>
        {text.split("\n").map((line, i) => (
          <text key={i} fg={theme.text}>
            {line || " "}
          </text>
        ))}
        <text fg={theme.accentSoft}>▌</text>
      </box>
    </box>
  );
}
