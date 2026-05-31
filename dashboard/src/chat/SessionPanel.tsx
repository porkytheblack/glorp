/**
 * Right context panel for the active session: stats, the working plan, and the
 * task checklist. Logic ported from components/EnvironmentPanel.tsx (reads
 * controller.state.plan/tasks/stats); no git, per the redesign. Rendered beside
 * the chat column and toggled from SessionTopBar.
 */

import { Circle, CircleDashed, CircleCheck } from "lucide-react";
import type { SessionState } from "../state/reducer.ts";
import type { SessionDto, TaskItem } from "../types.ts";

export interface SessionPanelProps {
  session: SessionDto;
  state: SessionState;
}

function TaskMark({ status }: { status: TaskItem["status"] }) {
  if (status === "completed") return <CircleCheck size={14} className="shrink-0 text-glorp-success" />;
  if (status === "in_progress") return <CircleDashed size={14} className="shrink-0 text-glorp-accent" />;
  return <Circle size={14} className="shrink-0 text-glorp-muted" />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-glorp-border px-4 py-4">
      <div className="mb-2.5 text-[11px] font-medium uppercase tracking-wider text-glorp-muted">{title}</div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-glorp-muted">{label}</dt>
      <dd className="truncate text-glorp-text">{value}</dd>
    </div>
  );
}

export function SessionPanel(p: SessionPanelProps) {
  const { session, state } = p;
  return (
    <aside className="glass h-full w-72 shrink-0 overflow-y-auto border-l border-glorp-border">
      <Section title="Stats">
        <dl className="space-y-2 text-[13px] text-glorp-text">
          <Stat label="Turns" value={state.stats?.turns ?? session.turn_count} />
          <Stat label="Tokens in" value={state.stats?.tokens_in ?? session.tokens_in} />
          <Stat label="Tokens out" value={state.stats?.tokens_out ?? session.tokens_out} />
          <Stat label="Context" value={`${state.stats?.contextPct ?? 0}%`} />
        </dl>
      </Section>

      <Section title="Plan">
        {state.plan ? (
          <div className="text-[13px]">
            <div className="mb-1 text-glorp-text">{state.plan.title}</div>
            <pre className="whitespace-pre-wrap text-[12px] leading-relaxed text-glorp-muted">{state.plan.body}</pre>
          </div>
        ) : (
          <p className="text-[13px] text-glorp-muted">No plan yet.</p>
        )}
      </Section>

      <Section title={`Tasks (${state.tasks.length})`}>
        {state.tasks.length === 0 ? (
          <p className="text-[13px] text-glorp-muted">No tasks.</p>
        ) : (
          <ul className="space-y-2 text-[13px]">
            {state.tasks.map((t) => (
              <li key={t.id} className="flex items-start gap-2 text-glorp-text">
                <span className="mt-0.5">
                  <TaskMark status={t.status} />
                </span>
                <span className={t.status === "completed" ? "leading-snug text-glorp-muted line-through" : "leading-snug"}>
                  {t.status === "in_progress" ? t.activeForm : t.content}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </aside>
  );
}
