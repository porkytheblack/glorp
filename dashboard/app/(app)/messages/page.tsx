"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@/lib/hooks";
import { PageHeader, Loading, EmptyState, StateBadge, Field, timeAgo } from "@/components/ui";
import type { SessionDto } from "@/lib/types";

interface Result { status: string; busy: boolean; text: string | null; last_error: string | null; reason: string; turn_count: number; }

function Conversation({ sessionId }: { sessionId: string }) {
  const result = useQuery<Result>(`/sessions/${sessionId}/result`, [sessionId]);
  const tasks = useQuery<{ tasks: { content?: string; title?: string; status?: string }[] }>(`/sessions/${sessionId}/tasks`, [sessionId]);

  if (result.loading) return <Loading />;
  const r = result.data;
  const taskList = tasks.data?.tasks ?? [];

  return (
    <div className="grid cols-2">
      <div className="card">
        <div className="row spread" style={{ marginBottom: 10 }}>
          <strong>Latest answer</strong>
          <span className="badge dot">{r?.reason ?? "—"}</span>
        </div>
        {r?.last_error ? (
          <div className="badge red dot">{r.last_error}</div>
        ) : r?.text ? (
          <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--text-dim)" }}>{r.text}</pre>
        ) : (
          <span className="faint">No answer yet.</span>
        )}
      </div>
      <div className="card">
        <strong>Tasks</strong>
        {taskList.length === 0 ? (
          <div className="faint mt-1">No tasks tracked.</div>
        ) : (
          <ul style={{ paddingLeft: 18, marginTop: 10 }}>
            {taskList.map((t, i) => (
              <li key={i} className="muted" style={{ marginBottom: 4 }}>
                <span className="code-pill" style={{ marginRight: 6 }}>{t.status ?? "?"}</span>{t.title ?? ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function MessagesPage() {
  const { data, loading } = useQuery<{ sessions: SessionDto[] }>("/sessions");
  const [selected, setSelected] = useState("");
  const sessions = (data?.sessions ?? []).slice().sort((a, b) => b.last_activity.localeCompare(a.last_activity));
  const active = selected || sessions[0]?.id || "";

  return (
    <div>
      <PageHeader title="Messages" subtitle="The agent's most recent answer and live task list for each session — the orchestration inbox at a glance." />
      {loading ? <Loading /> : sessions.length === 0 ? (
        <EmptyState icon="✉" title="No conversations yet" />
      ) : (
        <>
          <Field label="Session">
            <select className="select" style={{ maxWidth: 420 }} value={active} onChange={(e) => setSelected(e.target.value)}>
              {sessions.map((s) => <option key={s.id} value={s.id}>{s.title ?? s.id}</option>)}
            </select>
          </Field>
          <div className="row spread" style={{ marginBottom: 14 }}>
            <Link href={`/sessions/${active}`} className="btn ghost sm">Open live view →</Link>
            {(() => { const s = sessions.find((x) => x.id === active); return s ? <StateBadge state={s.state} /> : null; })()}
          </div>
          {active && <Conversation sessionId={active} />}
        </>
      )}
    </div>
  );
}
