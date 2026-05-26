/**
 * Agent runner panel: displayed below the input bar when loop agents
 * are active. Collapsed mode shows a single-line summary bar;
 * expanded mode shows per-agent chips with stats and verdicts.
 */
import React from "react";
import { theme } from "../theme.ts";
import type { UiState } from "../store-reducer.ts";
import type { RunnerAgentStats } from "../../shared/events.ts";

const PHASE_ICON: Record<string, { icon: string; color: string }> = {
  generating: { icon: "⠋", color: theme.warning },
  evaluating: { icon: "⠹", color: theme.loopActive },
  checkpoint: { icon: "◆", color: theme.accent },
  idle: { icon: "○", color: theme.textMuted },
  terminated: { icon: "✗", color: theme.error },
  completed: { icon: "✓", color: theme.success },
};

const VERDICT_ICON: Record<string, string> = { proceed: "✓", retry: "↺", terminate: "✗" };

interface Props {
  state: UiState;
  width: number;
  collapsed?: boolean;
}

export function AgentRunner({ state, width, collapsed }: Props) {
  const agents = Object.values(state.runnerStats);
  const hasLoop = state.loopPhase && state.loopPhase !== "idle";
  if (agents.length === 0 && !hasLoop) return null;

  if (collapsed) return <RunnerBar agents={agents} state={state} width={width} />;

  const lane = Math.max(10, width - 4);
  return (
    <box flexDirection="column" width={width} paddingX={1}>
      <text fg={theme.border}>{"─".repeat(Math.max(1, width - 2))}</text>
      <box flexDirection="row" gap={2}>
        {agents.map((a) => <AgentChip key={a.agentId} agent={a} fg={state.foregroundAgent} lane={lane} />)}
        {hasLoop && <LoopBadge phase={state.loopPhase!} verdicts={state.loopVerdicts} />}
      </box>
    </box>
  );
}

/** Single-line collapsed bar: ▸ ⠋ gen 3t 1.2k │ ⠹ eval 2t │ loop ⠋ */
function RunnerBar({ agents, state, width }: {
  agents: Array<RunnerAgentStats & { updatedAt: number }>;
  state: UiState;
  width: number;
}) {
  const hasLoop = state.loopPhase && state.loopPhase !== "idle";
  const parts: string[] = [];
  for (const a of agents) {
    const ph = PHASE_ICON[a.phase] ?? PHASE_ICON.idle;
    const fg = state.foregroundAgent === a.agentId ? "★" : ph.icon;
    parts.push(`${fg} ${clip(a.label, 10)} ${a.turns}t ${formatK(a.tokensIn + a.tokensOut)}`);
  }
  if (hasLoop) {
    const lph = PHASE_ICON[state.loopPhase!] ?? PHASE_ICON.idle;
    parts.push(`${lph.icon} loop`);
  }
  const summary = parts.join(" │ ");
  return (
    <box flexDirection="row" width={width} paddingX={1}>
      <text fg={theme.agent}>▸ </text>
      <text fg={theme.textMuted}>{clip(summary, Math.max(1, width - 4))}</text>
    </box>
  );
}

function AgentChip({ agent, fg, lane }: {
  agent: RunnerAgentStats & { updatedAt: number };
  fg: string | null;
  lane: number;
}) {
  const isFg = fg === agent.agentId;
  const ph = PHASE_ICON[agent.phase] ?? PHASE_ICON.idle;
  const label = clip(agent.label, Math.min(18, Math.floor(lane / 3)));
  return (
    <box flexDirection="row" gap={1}>
      <text fg={isFg ? theme.accent : ph.color}>{isFg ? "★" : ph.icon}</text>
      <text fg={isFg ? theme.accent : theme.agent}>{label}</text>
      <text fg={theme.textDim}>{agent.role}</text>
      <text fg={theme.textMuted}>{agent.turns}t {formatK(agent.tokensIn + agent.tokensOut)}</text>
    </box>
  );
}

function LoopBadge({ phase, verdicts }: { phase: string; verdicts: UiState["loopVerdicts"] }) {
  const ph = PHASE_ICON[phase] ?? PHASE_ICON.idle;
  const last = verdicts.at(-1);
  return (
    <box flexDirection="row" gap={1}>
      <text fg={ph.color}>{ph.icon} loop</text>
      {last && <text fg={theme.textMuted}>{VERDICT_ICON[last.action] ?? "·"} {clip(last.checkpoint, 14)}</text>}
    </box>
  );
}

export function hasRunnerContent(state: UiState): boolean {
  return Object.keys(state.runnerStats).length > 0 || (!!state.loopPhase && state.loopPhase !== "idle");
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function clip(v: string, max: number): string {
  return v.length <= max ? v : v.slice(0, max - 1) + "…";
}
