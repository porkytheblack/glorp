"use client";

import { useState } from "react";
import { useQuery, useToasts } from "@/lib/hooks";
import { api } from "@/lib/api";
import { PageHeader, Loading, EmptyState, ErrorNote, DeleteButton, Toasts } from "@/components/ui";
import type { Catalog, ProviderWire, ProfileWire } from "@/lib/types";
import { AddProviderModal } from "./add-provider-modal";
import { AddProfileModal } from "./add-profile-modal";

export default function CredentialsPage() {
  const providers = useQuery<{ providers: ProviderWire[] }>("/models/providers");
  const profiles = useQuery<{ profiles: ProfileWire[]; active_profile_id: string | null }>("/models/profiles");
  const catalog = useQuery<Catalog>("/models/catalog");
  const { toasts, push } = useToasts();

  const [provOpen, setProvOpen] = useState(false);
  const [profOpen, setProfOpen] = useState(false);

  const act = async (fn: () => Promise<unknown>, ok: string, reload: () => void) => {
    try { await fn(); reload(); push(ok, "success"); }
    catch (e) { push(e instanceof Error ? e.message : "Failed", "error"); }
  };

  const provs = providers.data?.providers ?? [];
  const profs = profiles.data?.profiles ?? [];
  const activeId = profiles.data?.active_profile_id;

  return (
    <div>
      <PageHeader title="Credentials" subtitle="Model providers and the profiles sessions inherit by default. Keys are stored via the configured credential storage adapter and never returned." />

      <div className="card-row" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Providers</h3>
        <button className="btn sm" onClick={() => setProvOpen(true)}>+ Add provider</button>
      </div>
      {providers.error && <ErrorNote message={providers.error} />}
      <div className="card" style={{ padding: 0, marginBottom: 26 }}>
        {providers.loading ? <Loading /> : provs.length === 0 ? <EmptyState icon="⚿" title="No providers configured" /> : (
          <table className="table">
            <thead><tr><th>Provider</th><th>Type</th><th>Base URL</th><th>Context</th><th>API key</th><th /></tr></thead>
            <tbody>
              {provs.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}{p.based_on && <span className="muted"> · based on {p.based_on}</span>}</td>
                  <td className="muted">{p.adapter ? `${p.type} (${p.adapter})` : p.type}</td>
                  <td className="mono">{p.base_url ?? "—"}</td>
                  <td className="mono">{p.context_limit ?? "—"}</td>
                  <td>{p.has_api_key ? <span className="badge green dot">set</span> : <span className="badge">none</span>}</td>
                  <td className="row" style={{ justifyContent: "flex-end" }}>
                    <DeleteButton onConfirm={() => act(() => api(`/models/providers/${p.id}`, { method: "DELETE" }), "Provider removed", providers.reload)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card-row" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Model profiles</h3>
        <button className="btn sm" onClick={() => setProfOpen(true)}>+ Add profile</button>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {profiles.loading ? <Loading /> : profs.length === 0 ? <EmptyState icon="✦" title="No profiles" /> : (
          <table className="table">
            <thead><tr><th>Label</th><th>Provider</th><th>Model</th><th /></tr></thead>
            <tbody>
              {profs.map((p) => (
                <tr key={p.id}>
                  <td>{p.label} {p.id === activeId && <span className="badge green">active</span>}</td>
                  <td className="muted">{p.provider_id}</td>
                  <td className="mono">{p.model}</td>
                  <td className="row" style={{ justifyContent: "flex-end" }}>
                    {p.id !== activeId && <button className="btn ghost sm" onClick={() => act(() => api(`/models/profiles/${p.id}/activate`, { method: "POST" }), "Profile activated", profiles.reload)}>Activate</button>}
                    <DeleteButton onConfirm={() => act(() => api(`/models/profiles/${p.id}`, { method: "DELETE" }), "Profile removed", profiles.reload)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {provOpen && <AddProviderModal catalog={catalog.data} onClose={() => setProvOpen(false)} onSaved={(m) => { providers.reload(); push(m, "success"); }} />}
      {profOpen && <AddProfileModal providers={provs} catalog={catalog.data} onClose={() => setProfOpen(false)} onSaved={(m) => { profiles.reload(); push(m, "success"); }} />}
      <Toasts toasts={toasts} />
    </div>
  );
}
