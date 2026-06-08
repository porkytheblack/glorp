"use client";

import { useState } from "react";
import { useQuery, useToasts } from "@/lib/hooks";
import { api } from "@/lib/api";
import { PageHeader, Loading, EmptyState, ErrorNote, Field, DeleteButton, Toasts } from "@/components/ui";
import type { SessionDto, AgentInfo } from "@/lib/types";

function Roster({ sessionId, push }: { sessionId: string; push: (m: string, k?: "info" | "success" | "error") => void }) {
  const { data, loading, error, reload } = useQuery<{ agents: AgentInfo[]; active_agent_id: string }>(`/sessions/${sessionId}/agents`, [sessionId]);
  const [role, setRole] = useState("");

  const add = async () => {
    if (!role.trim()) return;
    try { await api(`/sessions/${sessionId}/agents`, { method: "POST", body: { role: role.trim() } }); setRole(""); reload(); push("Agent added", "success"); }
    catch (e) { push(e instanceof Error ? e.message : "Failed", "error"); }
  };
  const switchTo = async (aid: string) => {
    try { await api(`/sessions/${sessionId}/agents/${aid}`, { method: "POST" }); reload(); push("Active agent switched", "success"); }
    catch (e) { push(e instanceof Error ? e.message : "Failed", "error"); }
  };
  const remove = async (aid: string) => {
    try { await api(`/sessions/${sessionId}/agents/${aid}`, { method: "DELETE" }); reload(); push("Agent removed", "success"); }
    catch (e) { push(e instanceof Error ? e.message : "Failed", "error"); }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  const agents = data?.agents ?? [];
  const active = data?.active_agent_id;

  return (
    <>
      <div className="card" style={{ padding: 0, marginBottom: 14 }}>
        {agents.length === 0 ? <EmptyState icon="✦" title="No agents in this session" /> : (
          <table className="table">
            <thead><tr><th>Label</th><th>Role</th><th>Turns</th><th>Status</th><th /></tr></thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}>
                  <td>{a.label} {a.id === active && <span className="badge green">active</span>}</td>
                  <td className="muted">{a.role}</td>
                  <td>{a.turnCount}</td>
                  <td>{a.busy ? <span className="badge amber dot">busy</span> : <span className="badge dot">idle</span>}</td>
                  <td className="row" style={{ justifyContent: "flex-end" }}>
                    {a.id !== active && <button className="btn ghost sm" onClick={() => switchTo(a.id)}>Make active</button>}
                    {a.id !== active && <DeleteButton onConfirm={() => remove(a.id)} label="Remove" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="row">
        <input className="input" style={{ maxWidth: 280 }} placeholder="new agent role (e.g. reviewer)" value={role} onChange={(e) => setRole(e.target.value)} />
        <button className="btn" onClick={add}>+ Add agent</button>
      </div>
    </>
  );
}

export default function AgentsPage() {
  const { data, loading } = useQuery<{ sessions: SessionDto[] }>("/sessions");
  const { toasts, push } = useToasts();
  const [selected, setSelected] = useState<string>("");

  const sessions = data?.sessions ?? [];
  const active = selected || sessions[0]?.id || "";

  return (
    <div>
      <PageHeader title="Agents" subtitle="The multi-agent roster within a session. Add specialist agents, switch the active one, or retire them." />
      {loading ? <Loading /> : sessions.length === 0 ? (
        <EmptyState icon="✦" title="No sessions" hint="Agents live inside sessions — create one first." />
      ) : (
        <>
          <Field label="Session">
            <select className="select" style={{ maxWidth: 420 }} value={active} onChange={(e) => setSelected(e.target.value)}>
              {sessions.map((s) => <option key={s.id} value={s.id}>{s.title ?? s.id}</option>)}
            </select>
          </Field>
          {active && <Roster sessionId={active} push={push} />}
        </>
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}
