/**
 * Sidebar panel showing orchestrator agents, loop phase, and plan status.
 * Extracted from sidebar.tsx so the agent/orchestrator display has room
 * to grow without pushing sidebar over the 200-line ceiling.
 */
import React from "react";
import { theme } from "../theme.ts";
import type { UiState } from "../store-reducer.ts";
import type { OrchestratorPhase } from "../../shared/events.ts";

const PHASE_LABEL: Record<OrchestratorPhase, { icon: string; label: string; color: string }> = {
  idle: { icon: "○", label: "idle", color: theme.textMuted },
  generating: { icon: "⠋", label: "generating", color: theme.warning },
  evaluating: { icon: "⠹", label: "evaluating", color: theme.loopActive },
  checkpoint: { icon: "◆", label: "checkpoint", color: theme.accent },
  terminated: { icon: "✗", label: "terminated", color: theme.error },
  completed: { icon: "✓", label: "completed", color: theme.success },
};

const VERDICT_ICON: Record<string, { icon: string; color: string }> = {
  proceed: { icon: "✓", color: theme.success },
  retry: { icon: "↺", color: theme.warning },
  terminate: { icon: "✗", color: theme.error },
};

interface Props {
  state: UiState;
  lane: number;
}

export function AgentPanel({ state, lane }: Props) {
  const spawned = state.orchestratorAgents.filter((a) => a.action === "spawned");
  const totalActive = state.activeSubagents.length + spawned.length;
  const hasLoop = state.loopPhase && state.loopPhase !== "idle";

  return (
    <box flexDirection="column" gap={1}>
      {/* Active agents */}
      {state.activeSubagents.slice(0, 3).map((name, i) => (
        <box key={`sub-${name}-${i}`} flexDirection="row">
          <text fg={theme.textMuted}>  </text>
          <text fg={theme.toolName}>@{clip(name, lane - 4)}</text>
        </box>
      ))}
      {spawned.slice(0, 5).map((agent) => {
        const isFg = state.foregroundAgent === agent.id;
        return (
          <box key={agent.id} flexDirection="column">
            <box flexDirection="row">
              <text fg={isFg ? theme.accent : theme.textMuted}>{isFg ? "★ " : "  "}</text>
              <text fg={theme.agent}>{clip(agent.label, lane - 14)} </text>
              <text fg={theme.textDim}>({agent.role ?? "agent"})</text>
            </box>
          </box>
        );
      })}
      {totalActive === 0 && !hasLoop && (
        <text fg={theme.textDim}>No active agents</text>
      )}

      {/* Gen-eval loop progress */}
      {hasLoop && <LoopStatus state={state} lane={lane} />}
    </box>
  );
}

function LoopStatus({ state, lane }: { state: UiState; lane: number }) {
  const ph = state.loopPhase!;
  const info = PHASE_LABEL[ph];
  const verdicts = state.loopVerdicts;

  return (
    <box flexDirection="column" marginTop={0}>
      <box flexDirection="row">
        <text fg={info.color}>{info.icon} </text>
        <text fg={info.color}><strong>{info.label}</strong></text>
      </box>
      {verdicts.slice(-3).map((v, i) => {
        const vi = VERDICT_ICON[v.action] ?? { icon: "·", color: theme.textMuted };
        return (
          <box key={i} flexDirection="row">
            <text fg={vi.color}>  {vi.icon} </text>
            <text fg={theme.text}>{clip(v.checkpoint, lane - 6)}</text>
          </box>
        );
      })}
    </box>
  );
}

export function agentPanelTitle(state: UiState): { title: string; color: string } {
  const spawned = state.orchestratorAgents.filter((a) => a.action === "spawned");
  const total = state.activeSubagents.length + spawned.length;
  const hasLoop = state.loopPhase && state.loopPhase !== "idle";
  const color = hasLoop ? theme.loopActive : total > 0 ? theme.warning : theme.textMuted;
  return { title: `Agents ${total} active`, color };
}

function clip(value: string, width: number): string {
  const max = Math.max(1, width);
  return value.length <= max ? value : value.slice(0, max - 1) + "…";
}
