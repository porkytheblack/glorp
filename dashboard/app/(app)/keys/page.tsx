"use client";

import { useState } from "react";
import { useQuery, useToasts } from "@/lib/hooks";
import { api } from "@/lib/api";
import { PageHeader, Loading, EmptyState, ErrorNote, Modal, Field, DeleteButton, Toasts, timeAgo } from "@/components/ui";
import type { ApiKeyPublic } from "@/lib/types";

export default function KeysPage() {
  const { data, loading, error, reload } = useQuery<{ data: ApiKeyPublic[] }>("/keys");
  const { toasts, push } = useToasts();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState("admin");
  const [busy, setBusy] = useState(false);
  const [minted, setMinted] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const res = await api<{ data: { key: string } }>("/keys", {
        method: "POST",
        body: { name: name.trim() || "api-key", scopes: [scope] },
      });
      setMinted(res.data.key);
      reload();
    } catch (e) {
      push(e instanceof Error ? e.message : "Mint failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setOpen(false);
    setName("");
    setMinted(null);
  };

  const revoke = async (id: string) => {
    try {
      await api(`/keys/${id}`, { method: "DELETE" });
      push("Key revoked", "success");
      reload();
    } catch (e) {
      push(e instanceof Error ? e.message : "Revoke failed", "error");
    }
  };

  const keys = data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="API Keys"
        subtitle="Mint keys for the REST API and the MCP server. Set a key as GLORP_API_KEY for the MCP server, or send it as a Bearer token to the API."
        action={<button className="btn primary" onClick={() => setOpen(true)}>+ Mint key</button>}
      />

      {error && <ErrorNote message={error} />}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <Loading />
        ) : keys.length === 0 ? (
          <EmptyState icon="⚷" title="No API keys" hint="Mint one for a client or the MCP server." />
        ) : (
          <table className="table">
            <thead><tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Last used</th><th>Created</th><th /></tr></thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} style={{ opacity: k.revoked ? 0.5 : 1 }}>
                  <td>{k.name}{k.revoked && <span className="badge red" style={{ marginLeft: 8 }}>revoked</span>}</td>
                  <td className="mono">{k.keyPrefix}…</td>
                  <td>{k.scopes.map((s) => <span key={s} className="badge" style={{ marginRight: 4 }}>{s}</span>)}</td>
                  <td className="muted">{timeAgo(k.lastUsed)}</td>
                  <td className="muted">{timeAgo(k.createdAt)}</td>
                  <td style={{ textAlign: "right" }}>{!k.revoked && <DeleteButton label="Revoke" onConfirm={() => revoke(k.id)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <Modal
          title="Mint API key"
          subtitle="The raw key is shown once. Store it somewhere safe."
          submitLabel={minted ? "Done" : "Mint"}
          onClose={close}
          onSubmit={minted ? close : create}
          busy={busy}
        >
          {minted ? (
            <div>
              <p className="muted mt-0">Copy this key now — it won&apos;t be shown again.</p>
              <div className="code-pill" style={{ display: "block", wordBreak: "break-all", padding: 10 }}>{minted}</div>
            </div>
          ) : (
            <>
              <Field label="Name"><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="mcp-server" /></Field>
              <Field label="Scope">
                <select className="select" value={scope} onChange={(e) => setScope(e.target.value)}>
                  <option value="admin">admin — full control</option>
                  <option value="session">session — manage sessions only</option>
                </select>
              </Field>
            </>
          )}
        </Modal>
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}
