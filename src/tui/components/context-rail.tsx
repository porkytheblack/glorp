import React from "react";
import { theme } from "../theme.ts";
import type { UiState } from "../store-reducer.ts";

interface Props {
  state: UiState;
  width: number;
}

const TASK_MARK = { pending: "○", in_progress: "●", completed: "✓" } as const;
const TASK_COLOR = { pending: theme.textMuted, in_progress: theme.warning, completed: theme.success } as const;

export function ContextRail({ state, width }: Props) {
  const lane = Math.max(8, width - 2);
  const spawned = state.orchestratorAgents.filter((a) => a.action === "spawned");
  const activeAgents = state.activeSubagents.length + spawned.length;
  const openTasks = state.tasks.filter((t) => t.status !== "completed").length;
  const pendingInbox = state.inbox.filter((i) => i.status === "pending");

  return (
    <box flexDirection="column" width={width} paddingX={1} gap={1}>
      <ContextGauge stats={state.stats} lane={lane} />
      <PlanSection plan={state.plan} lane={lane} />
      <TasksSection tasks={state.tasks} open={openTasks} lane={lane} />
      <AgentsSection
        subagents={state.activeSubagents}
        spawned={spawned}
        foreground={state.foregroundAgent}
        count={activeAgents}
        lane={lane}
      />
      {state.mcpServers.length > 0 && <McpSection servers={state.mcpServers} lane={lane} />}
      {pendingInbox.length > 0 && <InboxSection items={pendingInbox} lane={lane} />}
      <SignalsSection signals={state.transmissions} lane={lane} />
    </box>
  );
}

function ContextGauge({ stats, lane }: { stats: UiState["stats"]; lane: number }) {
  const pct = stats.contextPct;
  const barLen = Math.min(10, lane - 8);
  const filled = Math.round((pct / 100) * barLen);
  const bar = `[${"█".repeat(filled)}${"░".repeat(barLen - filled)}]`;
  const color = pct >= 85 ? theme.error : pct >= 65 ? theme.warning : theme.success;
  return (
    <box flexDirection="column">
      <text fg={theme.textMuted}><strong>CTX</strong> <span fg={color}>{bar} {pct}%</span></text>
      <text fg={theme.textDim}>{stats.turns}t  {fmtK(stats.tokens_in)}/{fmtK(stats.tokens_out)} tok</text>
    </box>
  );
}

function PlanSection({ plan, lane }: { plan: UiState["plan"]; lane: number }) {
  if (!plan) return <text fg={theme.textDim}>PLAN none</text>;
  return (
    <box flexDirection="column">
      <text fg={theme.accent}><strong>PLAN</strong> r{plan.revision}</text>
      <text fg={theme.text}>{clip(plan.title, lane)}</text>
    </box>
  );
}

function TasksSection({ tasks, open, lane }: { tasks: UiState["tasks"]; open: number; lane: number }) {
  const ordered = [...tasks].sort((a, b) => taskOrder(a.status) - taskOrder(b.status));
  return (
    <box flexDirection="column">
      <text fg={open > 0 ? theme.warning : theme.textMuted}>
        <strong>TASKS</strong> {open}/{tasks.length}
      </text>
      {ordered.slice(0, 5).map((t) => (
        <box key={t.id} flexDirection="row">
          <text fg={TASK_COLOR[t.status]}>{TASK_MARK[t.status]} </text>
          <text fg={t.status === "completed" ? theme.textMuted : theme.text}>
            {clip(t.status === "in_progress" ? t.activeForm : t.content, lane - 3)}
          </text>
        </box>
      ))}
      {tasks.length > 5 && <text fg={theme.textDim}>+{tasks.length - 5} more</text>}
    </box>
  );
}

function AgentsSection({ subagents, spawned, foreground, count, lane }: {
  subagents: string[];
  spawned: UiState["orchestratorAgents"];
  foreground: string | null;
  count: number;
  lane: number;
}) {
  return (
    <box flexDirection="column">
      <text fg={count > 0 ? theme.warning : theme.textMuted}><strong>AGENTS</strong> {count}</text>
      {subagents.slice(0, 3).map((name, i) => (
        <text key={`s${i}`} fg={theme.toolName}>  @{clip(name, lane - 4)}</text>
      ))}
      {spawned.slice(0, 3).map((a) => (
        <text key={a.id} fg={foreground === a.id ? theme.accent : theme.agent}>
          {foreground === a.id ? " ★ " : "   "}{clip(a.label, lane - 5)}
        </text>
      ))}
    </box>
  );
}

function McpSection({ servers, lane }: { servers: UiState["mcpServers"]; lane: number }) {
  const connected = servers.filter((s) => s.state === "connected");
  const errored = servers.filter((s) => s.state === "error").length;
  const tools = connected.reduce((n, s) => n + s.toolCount, 0);
  return (
    <box flexDirection="column">
      <text fg={connected.length > 0 ? theme.transmission : theme.textMuted}>
        <strong>MCP</strong> {connected.length}/{servers.length}{tools > 0 ? ` · ${tools}t` : ""}
      </text>
      {servers.slice(0, 3).map((s) => (
        <box key={s.id} flexDirection="row">
          <text fg={mcpColor(s.state)}>{mcpMark(s.state)} </text>
          <text fg={s.state === "connected" ? theme.text : theme.textMuted}>
            {clip(s.name, lane - 7)}{s.state === "connected" ? ` ${s.toolCount}t` : ""}
          </text>
        </box>
      ))}
      {servers.length > 3 && <text fg={theme.textDim}>+{servers.length - 3} more{errored > 0 ? ` · ${errored} err` : ""}</text>}
    </box>
  );
}

function mcpMark(state: "connected" | "error" | "inactive"): string {
  return state === "connected" ? "●" : state === "error" ? "✗" : "○";
}

function mcpColor(state: "connected" | "error" | "inactive"): string {
  return state === "connected" ? theme.success : state === "error" ? theme.error : theme.textMuted;
}

function InboxSection({ items, lane }: { items: UiState["inbox"]; lane: number }) {
  const blocking = items.filter((i) => i.blocking).length;
  return (
    <box flexDirection="column">
      <text fg={blocking > 0 ? theme.warning : theme.textMuted}>
        <strong>INBOX</strong> {items.length}{blocking > 0 ? ` (${blocking} blocking)` : ""}
      </text>
      {items.slice(0, 3).map((item) => (
        <text key={item.id} fg={item.blocking ? theme.warning : theme.text}>
          {item.blocking ? "! " : "  "}{clip(item.tag, lane - 4)}
        </text>
      ))}
    </box>
  );
}

function SignalsSection({ signals, lane }: { signals: UiState["transmissions"]; lane: number }) {
  if (signals.length === 0) return null;
  const recent = signals.slice(-3);
  return (
    <box flexDirection="column">
      <text fg={theme.transmission}><strong>SIGNALS</strong></text>
      {recent.map((s, i) => (
        <text key={i} fg={sigColor(s.severity)}>{clip(s.payload, lane)}</text>
      ))}
    </box>
  );
}

function taskOrder(s: string): number {
  return s === "in_progress" ? 0 : s === "pending" ? 1 : 2;
}

function sigColor(severity: "low" | "medium" | "high"): string {
  return severity === "high" ? theme.transmissionHigh : severity === "medium" ? theme.transmission : theme.textMuted;
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function clip(s: string, max: number): string {
  const m = Math.max(1, max);
  return s.length <= m ? s : s.slice(0, m - 1) + "…";
}
