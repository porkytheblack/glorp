"use client";

import { useState } from "react";
import { useQuery, useToasts } from "@/lib/hooks";
import { api } from "@/lib/api";
import { PageHeader, Loading, EmptyState, ErrorNote, Modal, Field, DeleteButton, Toasts, timeAgo } from "@/components/ui";
import type { WorkspaceDto } from "@/lib/types";

export default function WorkspacesPage() {
  const { data, loading, error, reload } = useQuery<{ workspaces: WorkspaceDto[] }>("/workspaces");
  const { toasts, push } = useToasts();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const body: Record<string, string> = {};
      if (name.trim()) body.name = name.trim();
      if (path.trim()) body.path = path.trim();
      await api("/workspaces", { method: "POST", body });
      setOpen(false);
      setName("");
      setPath("");
      reload();
      push("Workspace created", "success");
    } catch (e) {
      push(e instanceof Error ? e.message : "Create failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const destroy = async (id: string) => {
    try {
      await api(`/workspaces/${id}`, { method: "DELETE" });
      push("Workspace deleted", "success");
      reload();
    } catch (e) {
      push(e instanceof Error ? e.message : "Delete failed", "error");
    }
  };

  const workspaces = data?.workspaces ?? [];

  return (
    <div>
      <PageHeader
        title="Workspaces"
        subtitle="Named directories on the Garage host that sessions run against."
        action={<button className="btn primary" onClick={() => setOpen(true)}>+ New workspace</button>}
      />

      {error && <ErrorNote message={error} />}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <Loading />
        ) : workspaces.length === 0 ? (
          <EmptyState icon="▦" title="No workspaces" hint="Create one, or let sessions create them on demand." />
        ) : (
          <table className="table">
            <thead><tr><th>Name</th><th>Path</th><th>Sessions</th><th>Created</th><th /></tr></thead>
            <tbody>
              {workspaces.map((w) => (
                <tr key={w.id}>
                  <td>{w.name}</td>
                  <td className="mono">{w.path}</td>
                  <td>{w.session_count}</td>
                  <td className="muted">{timeAgo(w.created_at)}</td>
                  <td style={{ textAlign: "right" }}><DeleteButton onConfirm={() => destroy(w.id)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <Modal title="New workspace" onClose={() => setOpen(false)} onSubmit={create} busy={busy}>
          <Field label="Name"><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Path (optional — created under the workspace root if blank)">
            <input className="input" placeholder="/home/dev/my-app" value={path} onChange={(e) => setPath(e.target.value)} />
          </Field>
        </Modal>
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}
