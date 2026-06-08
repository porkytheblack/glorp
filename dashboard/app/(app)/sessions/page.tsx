"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useToasts } from "@/lib/hooks";
import { api } from "@/lib/api";
import { PageHeader, Loading, EmptyState, ErrorNote, StateBadge, Modal, Field, DeleteButton, Toasts, timeAgo } from "@/components/ui";
import type { SessionDto } from "@/lib/types";

export default function SessionsPage() {
  const router = useRouter();
  const { data, loading, error, reload } = useQuery<{ sessions: SessionDto[]; total: number }>("/sessions");
  const { toasts, push } = useToasts();
  const [open, setOpen] = useState(false);
  const [workspace, setWorkspace] = useState("");
  const [permissionMode, setPermissionMode] = useState("normal");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { permissionMode };
      if (workspace.trim()) body.workspace = workspace.trim();
      const s = await api<SessionDto>("/sessions", { method: "POST", body });
      setOpen(false);
      setWorkspace("");
      router.push(`/sessions/${s.id}`);
    } catch (e) {
      push(e instanceof Error ? e.message : "Create failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const destroy = async (id: string) => {
    try {
      await api(`/sessions/${id}`, { method: "DELETE" });
      push("Session destroyed", "success");
      reload();
    } catch (e) {
      push(e instanceof Error ? e.message : "Delete failed", "error");
    }
  };

  const sessions = data?.sessions ?? [];

  return (
    <div>
      <PageHeader
        title="Sessions"
        subtitle="Every agent session in this namespace — live, idle, or rehydratable from disk."
        action={<button className="btn primary" onClick={() => setOpen(true)}>+ New session</button>}
      />

      {error && <ErrorNote message={error} />}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <Loading />
        ) : sessions.length === 0 ? (
          <EmptyState icon="▤" title="No sessions yet" hint="Launch one to put an agent to work." />
        ) : (
          <table className="table">
            <thead><tr><th>Title</th><th>State</th><th>Model</th><th>Workspace</th><th>Turns</th><th>Activity</th><th /></tr></thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td onClick={() => router.push(`/sessions/${s.id}`)} style={{ cursor: "pointer" }}>
                    {s.title ?? <span className="faint">untitled</span>}
                    <div className="faint mono" style={{ fontSize: 11 }}>{s.id}</div>
                  </td>
                  <td><StateBadge state={s.state} /></td>
                  <td className="muted">{s.model_label ?? "—"}</td>
                  <td className="mono">{s.workspace}</td>
                  <td>{s.turn_count}</td>
                  <td className="muted">{timeAgo(s.last_activity)}</td>
                  <td><DeleteButton onConfirm={() => destroy(s.id)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <Modal title="New session" subtitle="Point Garage at a workspace; leave blank for the default." onClose={() => setOpen(false)} onSubmit={create} busy={busy}>
          <Field label="Workspace path">
            <input className="input" placeholder="/home/dev/my-app" value={workspace} onChange={(e) => setWorkspace(e.target.value)} />
          </Field>
          <Field label="Permission mode">
            <select className="select" value={permissionMode} onChange={(e) => setPermissionMode(e.target.value)}>
              <option value="normal">normal — prompt for risky tools</option>
              <option value="auto">auto — auto-approve</option>
              <option value="bypass">bypass — no prompts</option>
            </select>
          </Field>
        </Modal>
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}
