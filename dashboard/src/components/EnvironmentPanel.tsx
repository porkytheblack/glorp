/**
 * Right column: the session's working context — plan, task checklist, and
 * stats. Git status + changed-files (with inline diffs) are a follow-up for
 * the UI team once the backend surfaces them.
 */

import type { SessionState } from "../state/reducer.ts";
import type { SessionDto, TaskItem } from "../types.ts";

const TASK_MARK: Record<TaskItem["status"], string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-glorp-border px-3 py-3">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-glorp-muted">{title}</div>
      {children}
    </div>
  );
}

export function EnvironmentPanel({ session, state }: { session: SessionDto | null; state: SessionState }) {
  if (!session) {
    return <aside className="h-full border-l border-glorp-border bg-glorp-surface" />;
  }

  return (
    <aside className="h-full overflow-y-auto border-l border-glorp-border bg-glorp-surface">
      <Section title="Stats">
        <dl className="space-y-1 text-glorp-text">
          <Stat label="Turns" value={state.stats?.turns ?? session.turn_count} />
          <Stat label="Tokens in" value={state.stats?.tokens_in ?? session.tokens_in} />
          <Stat label="Tokens out" value={state.stats?.tokens_out ?? session.tokens_out} />
          <Stat label="Context" value={`${state.stats?.contextPct ?? 0}%`} />
        </dl>
      </Section>

      <Section title="Plan">
        {state.plan ? (
          <div>
            <div className="mb-1 text-glorp-text">{state.plan.title}</div>
            <pre className="whitespace-pre-wrap text-[12px] text-glorp-muted">{state.plan.body}</pre>
          </div>
        ) : (
          <p className="text-glorp-muted">No plan yet.</p>
        )}
      </Section>

      <Section title={`Tasks (${state.tasks.length})`}>
        {state.tasks.length === 0 ? (
          <p className="text-glorp-muted">No tasks.</p>
        ) : (
          <ul className="space-y-1">
            {state.tasks.map((t) => (
              <li key={t.id} className="flex gap-2 text-glorp-text">
                <span className={t.status === "completed" ? "text-glorp-accent" : "text-glorp-muted"}>
                  {TASK_MARK[t.status]}
                </span>
                <span className={t.status === "completed" ? "text-glorp-muted line-through" : ""}>
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

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-glorp-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
