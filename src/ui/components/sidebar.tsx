import React from "react";
import { theme } from "../theme.ts";
import type { UiState } from "../store.ts";

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

const FLEET_COLOR = {
  running: theme.warning,
  resolved: theme.success,
  error: theme.error,
  cancelled: theme.textMuted,
} as const;

export function Sidebar({ state, width }: { state: UiState; width: number }) {
  const lane = Math.max(10, width - 4);
  const status = sessionStatus(state);
  const runningFleet = state.fleetJobs.filter((j) => j.status === "running");
  const activeAgents = state.activeSubagents.length + runningFleet.length;
  const openTasks = state.tasks.filter((t) => t.status !== "completed").length;
  const pendingInbox = state.inbox.filter((i) => i.status === "pending");
  const blockingInbox = pendingInbox.filter((i) => i.blocking);
  const recentFleet = [...runningFleet, ...state.fleetJobs.filter((j) => j.status !== "running").slice(-3)].slice(0, 5);

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

      <Panel title={`Agents ${activeAgents} active`} color={activeAgents ? theme.warning : theme.textMuted}>
        {activeAgents === 0 && recentFleet.length === 0 && <text fg={theme.textDim}>No active agents</text>}
        {state.activeSubagents.slice(0, 4).map((name, i) => (
          <text key={`sub-${name}-${i}`} fg={theme.warning}>subagent  {clip(name, lane - 10)}</text>
        ))}
        {recentFleet.map((job) => (
          <text key={job.runId} fg={FLEET_COLOR[job.status]}>
            fleet     {clip(`${job.name ?? job.kind} · ${job.runId.slice(0, 4)}`, lane - 10)}
          </text>
        ))}
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
  if (state.activeSubagents.length > 0 || state.fleetJobs.some((j) => j.status === "running")) {
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
