"use client";

import { Bot, FolderGit2, ListChecks, SlidersHorizontal } from "lucide-react";
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

function Section({ icon: Icon, title, extra, children }: { icon: typeof Bot; title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-border px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
          <Icon className="size-3.5" /> {title}
        </h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-[13px]">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-foreground">{children}</span>
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
      <Section
        icon={ListChecks}
        title="Tasks"
        extra={tasks.length > 0 ? <span className="text-[12px] text-muted-foreground">{done}/{tasks.length}</span> : null}
      >
        <TaskList tasks={tasks} compact />
      </Section>

      <Section icon={Bot} title="Agents" extra={<span className="text-[12px] text-muted-foreground">{agents.length}</span>}>
        <AgentRoster agents={agents} activeId={activeAgentId} onSwitch={onSwitchAgent} onAdd={onAddAgent} onRemove={onRemoveAgent} />
      </Section>

      <Section icon={SlidersHorizontal} title="Details">
        <Row label="Workspace">
          <span className="inline-flex items-center gap-1 font-mono text-[12px] text-muted-foreground" title={session.workspace}>
            <FolderGit2 className="size-3 shrink-0" />
            {baseName(session.workspace)}
          </span>
        </Row>
        <div className="py-1.5">
          <div className="mb-1 text-[13px] text-muted-foreground">Permission mode</div>
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
        <Row label="Context">
          <span className={cn(stats && stats.contextPct > 80 ? "text-warning" : undefined)}>{stats ? `${Math.round(stats.contextPct)}%` : "—"}</span>
        </Row>
        <Row label="Last activity">{timeAgo(session.last_activity)}</Row>
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
          <code className="min-w-0 truncate font-mono text-[11.5px] text-muted-foreground">{session.id}</code>
          <CopyButton value={session.id} />
        </div>
      </Section>
    </div>
  );
}
