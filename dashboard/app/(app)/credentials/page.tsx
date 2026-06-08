"use client";

import { useState } from "react";
import { useQuery, useToasts } from "@/lib/hooks";
import { api } from "@/lib/api";
import { PageHeader, Loading, EmptyState, ErrorNote, Modal, Field, DeleteButton, Toasts } from "@/components/ui";

interface ProviderRow { id: string; type: string; base_url: string | null; has_api_key: boolean; }
interface ProfileRow { id: string; label: string; provider_id: string; model: string; }

export default function CredentialsPage() {
  const providers = useQuery<{ providers: ProviderRow[] }>("/models/providers");
  const profiles = useQuery<{ profiles: ProfileRow[]; active_profile_id: string | null }>("/models/profiles");
  const { toasts, push } = useToasts();

  const [provOpen, setProvOpen] = useState(false);
  const [provId, setProvId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("");

  const [profOpen, setProfOpen] = useState(false);
  const [profProvider, setProfProvider] = useState("");
  const [profModel, setProfModel] = useState("");
  const [busy, setBusy] = useState(false);

  const addProvider = async () => {
    setBusy(true);
    try {
      await api("/models/providers", { method: "POST", body: { id: provId.trim(), apiKey: apiKey.trim() || undefined, baseURL: baseURL.trim() || undefined } });
      setProvOpen(false); setProvId(""); setApiKey(""); setBaseURL("");
      providers.reload();
      push("Provider saved", "success");
    } catch (e) { push(e instanceof Error ? e.message : "Failed", "error"); } finally { setBusy(false); }
  };

  const addProfile = async () => {
    setBusy(true);
    try {
      await api("/models/profiles", { method: "POST", body: { providerId: profProvider.trim(), model: profModel.trim(), activate: true } });
      setProfOpen(false); setProfModel("");
      profiles.reload();
      push("Profile added & activated", "success");
    } catch (e) { push(e instanceof Error ? e.message : "Failed", "error"); } finally { setBusy(false); }
  };

  const activate = async (id: string) => {
    try { await api(`/models/profiles/${id}/activate`, { method: "POST" }); profiles.reload(); push("Profile activated", "success"); }
    catch (e) { push(e instanceof Error ? e.message : "Failed", "error"); }
  };

  const removeProfile = async (id: string) => {
    try { await api(`/models/profiles/${id}`, { method: "DELETE" }); profiles.reload(); push("Profile removed", "success"); }
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
            <thead><tr><th>Provider</th><th>Type</th><th>Base URL</th><th>API key</th></tr></thead>
            <tbody>
              {provs.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td className="muted">{p.type}</td>
                  <td className="mono">{p.base_url ?? "—"}</td>
                  <td>{p.has_api_key ? <span className="badge green dot">set</span> : <span className="badge">none</span>}</td>
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
                    {p.id !== activeId && <button className="btn ghost sm" onClick={() => activate(p.id)}>Activate</button>}
                    <DeleteButton onConfirm={() => removeProfile(p.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {provOpen && (
        <Modal title="Add provider" subtitle="Known ids (anthropic, openai, …) infer their adapter; any other id is treated as a custom OpenAI-compatible endpoint." onClose={() => setProvOpen(false)} onSubmit={addProvider} busy={busy} submitLabel="Save">
          <Field label="Provider id"><input className="input" autoFocus placeholder="anthropic" value={provId} onChange={(e) => setProvId(e.target.value)} /></Field>
          <Field label="API key"><input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} /></Field>
          <Field label="Base URL (custom only)"><input className="input" placeholder="https://…/v1" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} /></Field>
        </Modal>
      )}
      {profOpen && (
        <Modal title="Add model profile" onClose={() => setProfOpen(false)} onSubmit={addProfile} busy={busy} submitLabel="Add">
          <Field label="Provider id"><input className="input" autoFocus placeholder="anthropic" value={profProvider} onChange={(e) => setProfProvider(e.target.value)} /></Field>
          <Field label="Model"><input className="input" placeholder="claude-sonnet-4-6" value={profModel} onChange={(e) => setProfModel(e.target.value)} /></Field>
        </Modal>
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}
