import React from "react";
import { theme } from "../theme.ts";
import type { UiState } from "../store.ts";
import { AgentPanel, agentPanelTitle } from "./agent-panel.tsx";

const TASK_MARK = {
  pending: "○",
  in_progress: "●",
  completed: "✓",
} as const;

const TASK_COLOR = {
  pending: theme.textMuted,
  in_progress: theme.warning,
  completed: theme.success,
} as const;

export function Sidebar({ state, width, collapsed }: { state: UiState; width: number; collapsed?: boolean }) {
  if (collapsed) return <SidebarStrip state={state} />;
  const lane = Math.max(10, width - 4);
  const status = sessionStatus(state);
  const spawnedAgents = state.orchestratorAgents.filter((a) => a.action === "spawned");
  const activeAgents = state.activeSubagents.length + spawnedAgents.length;
  const openTasks = state.tasks.filter((t) => t.status !== "completed").length;
  const pendingInbox = state.inbox.filter((i) => i.status === "pending");
  const blockingInbox = pendingInbox.filter((i) => i.blocking);

  return (
    <box flexDirection="column" width={width} padding={1} gap={1}>
      <Panel title="Session" color={status.color}>
        <text fg={status.color}><strong>{status.label}</strong></text>
        <text fg={theme.textMuted}>{activeAgents} agents · {openTasks} tasks · {pendingInbox.length} inbox</text>
      </Panel>

      <Panel title="Context" color={contextColor(state.stats.contextPct)}>
        <text fg={contextColor(state.stats.contextPct)}>{state.stats.contextPct}% {contextBar(state.stats.contextPct)}</text>
        <text fg={theme.textMuted}>{state.stats.turns} turns · in {formatCount(state.stats.tokens_in)}</text>
        <text fg={theme.textMuted}>out {formatCount(state.stats.tokens_out)}</text>
      </Panel>

      <Panel title={state.plan ? `Plan r${state.plan.revision}` : "Plan"} color={theme.accent}>
        {!state.plan && <text fg={theme.textDim}>No active plan</text>}
        {state.plan && (
          <>
            <text fg={theme.text}>{clip(state.plan.title, lane)}</text>
            <text fg={theme.textMuted}>{clip(firstPlanLine(state.plan.body), lane)}</text>
          </>
        )}
      </Panel>

      <Panel title={`Tasks ${openTasks}/${state.tasks.length}`} color={openTasks ? theme.warning : theme.textMuted}>
        {state.tasks.length === 0 && <text fg={theme.textDim}>No execution tasks</text>}
        {orderedTasks(state).slice(0, 7).map((t) => (
          <box key={t.id} flexDirection="row">
            <text fg={TASK_COLOR[t.status]}>{TASK_MARK[t.status]} </text>
            <text fg={t.status === "completed" ? theme.textMuted : theme.text}>
              {clip(t.status === "in_progress" ? t.activeForm : t.content, lane - 2)}
            </text>
          </box>
        ))}
        {state.tasks.length > 7 && <text fg={theme.textDim}>+{state.tasks.length - 7} more</text>}
      </Panel>

      <Panel title={`Inbox ${pendingInbox.length} pending`} color={blockingInbox.length ? theme.warning : theme.textMuted}>
        {state.inbox.length === 0 && <text fg={theme.textDim}>No pending requests</text>}
        {orderedInbox(state).slice(0, 4).map((i) => (
          <box key={i.id} flexDirection="column">
            <text fg={i.blocking ? theme.warning : i.status === "pending" ? theme.text : theme.success}>
              {i.blocking ? "!" : i.status === "pending" ? "○" : "✓"} {clip(i.tag, lane - 2)}
            </text>
            <text fg={theme.textMuted}>  {clip(i.response ?? i.request, lane - 2)}</text>
          </box>
        ))}
        {blockingInbox.length > 0 && <text fg={theme.warning}>{blockingInbox.length} blocking</text>}
      </Panel>

      <Panel title={agentPanelTitle(state).title} color={agentPanelTitle(state).color}>
        <AgentPanel state={state} lane={lane} />
      </Panel>

      <Panel title="Signals" color={theme.transmission}>
        {state.transmissions.length === 0 && <text fg={theme.textDim}>No recent signals</text>}
        {state.transmissions.slice(-4).map((signal, i) => (
          <text key={i} fg={signalColor(signal.severity)}>{clip(signal.payload, lane)}</text>
        ))}
      </Panel>
    </box>
  );
}

export const SIDEBAR_STRIP_WIDTH = 8;

/** Collapsed sidebar: narrow vertical strip with key metrics. */
function SidebarStrip({ state }: { state: UiState }) {
  const pct = state.stats.contextPct;
  const spawned = state.orchestratorAgents.filter((a) => a.action === "spawned");
  const agents = state.activeSubagents.length + spawned.length;
  const tasks = state.tasks.filter((t) => t.status !== "completed").length;
  const inbox = state.inbox.filter((i) => i.status === "pending").length;
  const hasLoop = state.loopPhase && state.loopPhase !== "idle";
  return (
    <box flexDirection="column" width={SIDEBAR_STRIP_WIDTH} paddingX={1} gap={0}>
      <text fg={theme.textDim}>{"─".repeat(SIDEBAR_STRIP_WIDTH - 2)}</text>
      <text fg={contextColor(pct)}>{pct}%</text>
      <text fg={theme.textMuted}>{state.stats.turns}t</text>
      {agents > 0 && <text fg={theme.agent}>{agents}a</text>}
      {tasks > 0 && <text fg={theme.warning}>{tasks}tk</text>}
      {inbox > 0 && <text fg={theme.warning}>{inbox}in</text>}
      {state.plan && <text fg={theme.accent}>P</text>}
      {hasLoop && <text fg={theme.loopActive}>⚡</text>}
      <text fg={theme.textDim}>◂</text>
    </box>
  );
}

function Panel({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <box flexDirection="column" border borderColor={theme.border} padding={1}>
      <text fg={color}><strong>{title}</strong></text>
      {children}
    </box>
  );
}

function sessionStatus(state: UiState): { label: string; color: string } {
  if (state.lastError) return { label: "Error", color: theme.error };
  if (state.loopPhase === "generating") return { label: "Generating", color: theme.loopActive };
  if (state.loopPhase === "evaluating") return { label: "Evaluating", color: theme.loopActive };
  if (state.activeSubagents.length > 0 || state.orchestratorAgents.some((a) => a.action === "spawned")) {
    return { label: "Agents running", color: theme.warning };
  }
  if (state.busy && state.streamingText) return { label: "Responding", color: theme.accent };
  if (state.busy) return { label: "Working", color: theme.warning };
  return { label: "Ready", color: theme.success };
}

function orderedTasks(state: UiState): UiState["tasks"] {
  const order = { in_progress: 0, pending: 1, completed: 2 };
  return [...state.tasks].sort((a, b) => order[a.status] - order[b.status]);
}

function orderedInbox(state: UiState): UiState["inbox"] {
  return [...state.inbox].sort((a, b) => scoreInbox(a) - scoreInbox(b));
}

function scoreInbox(item: UiState["inbox"][number]): number {
  if (item.status === "pending" && item.blocking) return 0;
  if (item.status === "pending") return 1;
  if (item.status === "resolved") return 2;
  return 3;
}

function contextColor(pct: number): string {
  if (pct >= 85) return theme.error;
  if (pct >= 65) return theme.warning;
  return theme.success;
}

function contextBar(pct: number): string {
  const cells = 10;
  const filled = Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)));
  return `[${"█".repeat(filled)}${"░".repeat(cells - filled)}]`;
}

function signalColor(severity: "low" | "medium" | "high"): string {
  if (severity === "high") return theme.transmissionHigh;
  if (severity === "medium") return theme.transmission;
  return theme.textMuted;
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${trimFixed(value / 1_000_000)}m`;
  if (value >= 1_000) return `${trimFixed(value / 1_000)}k`;
  return String(value);
}

function trimFixed(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function clip(value: string, width: number): string {
  const max = Math.max(1, width);
  return value.length <= max ? value : value.slice(0, max - 1) + "…";
}

function firstPlanLine(body: string): string {
  return body.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
}
