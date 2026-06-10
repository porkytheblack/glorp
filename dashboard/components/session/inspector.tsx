"use client";

import * as React from "react";
import { FolderGit2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { compact, timeAgo, baseName } from "@/lib/format";
import { CopyButton } from "@/components/shared";
import { TaskList } from "@/components/chat/task-list";
import { AgentRoster } from "@/components/session/agent-roster";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { SessionDto, SessionStats, TaskItem, AgentInfo } from "@/lib/types";

const MODE_LABEL: Record<string, string> = {
  normal: "Normal — prompt for risky tools",
  auto: "Auto — auto-approve",
  bypass: "Bypass — no prompts",
};

/** A labeled section opened by the eyebrow idiom (11px uppercase tracking-wider). */
function Section({ eyebrow, count, children }: { eyebrow: string; count?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-border/60 px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-faint">{eyebrow}</h3>
        {count != null && <span className="tnum text-[11.5px] text-faint">{count}</span>}
      </div>
      {children}
    </section>
  );
}

/** A details row: quiet label left, tabular value right. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-[12.5px]">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="tnum min-w-0 text-right text-foreground">{children}</span>
    </div>
  );
}

/** Thin context-usage meter — surface-2 track, brand fill, warning past ~80%. */
function ContextMeter({ pct }: { pct: number }) {
  const v = Math.max(0, Math.min(100, pct));
  const hot = v > 80;
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
        <span className="text-muted-foreground">Context</span>
        <span className={cn("tnum", hot ? "text-warning" : "text-foreground")}>{Math.round(v)}%</span>
      </div>
      <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div className={cn("h-full rounded-full transition-all", hot ? "bg-warning" : "bg-brand")} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

export function Inspector({
  session,
  stats,
  tasks,
  agents,
  activeAgentId,
  mode,
  onMode,
  onSwitchAgent,
  onAddAgent,
  onRemoveAgent,
}: {
  session: SessionDto;
  stats: SessionStats | null;
  tasks: TaskItem[];
  agents: AgentInfo[];
  activeAgentId: string | null;
  mode: string;
  onMode: (m: string) => void;
  onSwitchAgent: (id: string) => void;
  onAddAgent: (role: string) => void;
  onRemoveAgent: (id: string) => void;
}) {
  const done = tasks.filter((t) => t.status === "completed").length;

  return (
    <div className="h-full overflow-y-auto">
      <Section eyebrow="Tasks" count={tasks.length > 0 ? `${done}/${tasks.length}` : null}>
        <TaskList tasks={tasks} compact />
      </Section>

      <Section eyebrow="Agents" count={agents.length > 0 ? agents.length : null}>
        <AgentRoster agents={agents} activeId={activeAgentId} onSwitch={onSwitchAgent} onAdd={onAddAgent} onRemove={onRemoveAgent} />
      </Section>

      <Section eyebrow="Details">
        <Row label="Workspace">
          <span className="inline-flex items-center gap-1 font-mono text-[12px] text-muted-foreground" title={session.workspace}>
            <FolderGit2 className="size-3 shrink-0" />
            {baseName(session.workspace)}
          </span>
        </Row>
        <div className="py-1.5">
          <div className="mb-1.5 text-[12.5px] text-muted-foreground">Permission mode</div>
          <Select value={mode} onValueChange={onMode}>
            <SelectTrigger className="h-8 text-[12.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(MODE_LABEL).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Row label="Turns">{stats ? stats.turns : session.turn_count}</Row>
        <Row label="Tokens">{stats ? `${compact(stats.tokens_in)} in · ${compact(stats.tokens_out)} out` : "—"}</Row>
        {stats && <ContextMeter pct={stats.contextPct} />}
        <Row label="Last activity">{timeAgo(session.last_activity)}</Row>
        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 shadow-sheen">
          <code className="min-w-0 truncate font-mono text-[11.5px] text-faint">{session.id}</code>
          <CopyButton value={session.id} />
        </div>
      </Section>
    </div>
  );
}
