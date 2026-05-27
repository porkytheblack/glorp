/**
 * Renders orchestrator activity entries in the transcript.
 * Handles verdict, plan, and slot-change system turns injected
 * by the store reducer (turns with meta.orchestrator === true).
 */
import React from "react";
import { theme } from "../theme.ts";
import type { ChatTurn } from "../../shared/events.ts";

const VERDICT_GLYPH: Record<string, { icon: string; color: string }> = {
  proceed: { icon: "✓", color: theme.success },
  retry: { icon: "↺", color: theme.warning },
  terminate: { icon: "✗", color: theme.error },
};

export function isOrchestratorTurn(turn: ChatTurn): boolean {
  return turn.kind === "system" && (turn.meta?.orchestrator as boolean) === true;
}

export function OrchestratorRow({ turn }: { turn: ChatTurn }) {
  const subtype = (turn.meta?.subtype as string) ?? "unknown";
  const text = turn.text ?? "";

  if (subtype === "verdict") return <VerdictRow text={text} />;
  if (subtype === "plan") return <PlanRow text={text} />;
  return <GenericOrchRow text={text} />;
}

function VerdictRow({ text }: { text: string }) {
  // Text format: "checkpoint_name action: detail" or "checkpoint_name action"
  const match = text.match(/^(\S+)\s+(proceed|retry|terminate)(?::\s*(.*))?$/);
  if (!match) return <GenericOrchRow text={text} />;

  const [, checkpoint, action, detail] = match;
  const { icon, color } = VERDICT_GLYPH[action!] ?? { icon: "·", color: theme.textMuted };

  return (
    <box flexDirection="row" marginBottom={1}>
      <box width={6} marginRight={1}>
        <text fg={theme.agent}><strong>orch</strong></text>
      </box>
      <box flexDirection="column" flexGrow={1}>
        <box flexDirection="row">
          <text fg={color}>{icon} </text>
          <text fg={theme.text}>{checkpoint} </text>
          <text fg={color}><strong>{action}</strong></text>
        </box>
        {detail && <text fg={theme.textMuted}>  {detail}</text>}
      </box>
    </box>
  );
}

function PlanRow({ text }: { text: string }) {
  const isAccepted = text.startsWith("Plan accepted");
  const icon = isAccepted ? "✓" : "▣";
  const color = isAccepted ? theme.success : theme.loopActive;

  return (
    <box flexDirection="row" marginBottom={1}>
      <box width={6} marginRight={1}>
        <text fg={theme.agent}><strong>orch</strong></text>
      </box>
      <box flexDirection="row" flexGrow={1}>
        <text fg={color}>{icon} </text>
        <text fg={theme.text}>{text}</text>
      </box>
    </box>
  );
}

function GenericOrchRow({ text }: { text: string }) {
  return (
    <box flexDirection="row" marginBottom={1}>
      <box width={6} marginRight={1}>
        <text fg={theme.agent}><strong>orch</strong></text>
      </box>
      <text fg={theme.textMuted}>{text}</text>
    </box>
  );
}
