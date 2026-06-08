"use client";

import { useState } from "react";
import { useQuery, useToasts } from "@/lib/hooks";
import { api } from "@/lib/api";
import { PageHeader, Loading, EmptyState, ErrorNote, Modal, Field, DeleteButton, Toasts, timeAgo } from "@/components/ui";
import type { NamespaceDto } from "@/lib/types";

export default function NamespacesPage() {
  const { data, loading, error, reload } = useQuery<{ namespaces: NamespaceDto[] }>("/namespaces");
  const { toasts, push } = useToasts();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [mintFor, setMintFor] = useState<NamespaceDto | null>(null);
  const [keyName, setKeyName] = useState("");
  const [mintedKey, setMintedKey] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      await api("/namespaces", { method: "POST", body: { name: name.trim() } });
      setOpen(false);
      setName("");
      reload();
      push("Namespace created", "success");
    } catch (e) {
      push(e instanceof Error ? e.message : "Create failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const destroy = async (id: string) => {
    try {
      await api(`/namespaces/${id}`, { method: "DELETE", body: { removeData: false } });
      push("Namespace deleted", "success");
      reload();
    } catch (e) {
      push(e instanceof Error ? e.message : "Delete failed", "error");
    }
  };

  const mint = async () => {
    if (!mintFor) return;
    setBusy(true);
    try {
      const res = await api<{ data: { key: string } }>(`/namespaces/${mintFor.id}/keys`, {
        method: "POST",
        body: { name: keyName.trim() || "namespace-key" },
      });
      setMintedKey(res.data.key);
    } catch (e) {
      push(e instanceof Error ? e.message : "Mint failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const closeMint = () => {
    setMintFor(null);
    setKeyName("");
    setMintedKey(null);
  };

  const namespaces = data?.namespaces ?? [];

  return (
    <div>
      <PageHeader
        title="Namespaces"
        subtitle="Isolated tenant partitions — each has its own sessions, workspaces, credentials, and keys."
        action={<button className="btn primary" onClick={() => setOpen(true)}>+ New namespace</button>}
      />

      {error && <ErrorNote message={error} />}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <Loading />
        ) : namespaces.length === 0 ? (
          <EmptyState icon="▢" title="No namespaces" />
        ) : (
          <table className="table">
            <thead><tr><th>Name</th><th>Slug</th><th>Sessions</th><th>Created</th><th /></tr></thead>
            <tbody>
              {namespaces.map((n) => (
                <tr key={n.id}>
                  <td>{n.name} {n.is_default && <span className="badge">default</span>}</td>
                  <td className="mono">{n.slug}</td>
                  <td>{n.session_count ?? 0}</td>
                  <td className="muted">{timeAgo(n.created_at)}</td>
                  <td className="row" style={{ justifyContent: "flex-end" }}>
                    <button className="btn ghost sm" onClick={() => setMintFor(n)}>Mint key</button>
                    {!n.is_default && <DeleteButton onConfirm={() => destroy(n.id)} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <Modal title="New namespace" onClose={() => setOpen(false)} onSubmit={create} busy={busy}>
          <Field label="Name"><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        </Modal>
      )}

      {mintFor && (
        <Modal
          title={`Mint key for ${mintFor.name}`}
          subtitle="A namespace-bound API key may act only within this namespace."
          submitLabel={mintedKey ? "Done" : "Mint"}
          onClose={closeMint}
          onSubmit={mintedKey ? closeMint : mint}
          busy={busy}
        >
          {mintedKey ? (
            <div>
              <p className="muted mt-0">Copy this key now — it won&apos;t be shown again.</p>
              <div className="code-pill" style={{ display: "block", wordBreak: "break-all", padding: 10 }}>{mintedKey}</div>
            </div>
          ) : (
            <Field label="Key name"><input className="input" autoFocus value={keyName} onChange={(e) => setKeyName(e.target.value)} /></Field>
          )}
        </Modal>
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}
