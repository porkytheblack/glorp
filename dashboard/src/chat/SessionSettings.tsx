/**
 * Per-session settings modal (shadcn Dialog). Three sections, each wired to the
 * REST API:
 *   - Work mode   → api.setPermissionMode (normal / auto / bypass)
 *   - Model       → api.profiles() + api.setSessionProfile
 *   - Credential  → api.setCredential / api.clearCredential via an inline form
 *                   (shows provider + last4 only; the raw key is never read back)
 */

import { useEffect, useState } from "react";
import { Plus, CircleCheck, KeyRound, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { api, type ProfileSummary } from "../api/client.ts";
import type { SessionDto } from "../types.ts";

export interface SessionSettingsProps {
  session: SessionDto;
  permissionMode: string;
  onClose: () => void;
}

const MODES: { id: string; label: string; hint: string }[] = [
  { id: "normal", label: "Normal", hint: "Approve each action" },
  { id: "auto", label: "Auto-review", hint: "Run, ask on risky writes" },
  { id: "bypass", label: "Full access", hint: "No prompts" },
];

const row = "flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left hover:bg-glorp-surface-2";
const heading = "mb-1.5 text-[11px] font-medium uppercase tracking-wider text-glorp-muted";

function CredentialForm(p: { sessionId: string; onSaved: (c: SessionDto["custom_credentials"]) => void }) {
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = provider.trim() !== "" && apiKey.trim() !== "";

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      const s = await api.setCredential(p.sessionId, provider.trim(), apiKey.trim(), model.trim() || undefined);
      p.onSaved(s.custom_credentials);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-2 px-2.5 pb-1">
      <Input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Provider id (e.g. anthropic)" />
      <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API key" autoComplete="off" />
      <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model (optional)" />
      {error && <p className="text-[12px] text-glorp-error">{error}</p>}
      <Button size="sm" className="w-full" disabled={!ready || pending} onClick={() => void save()}>
        {pending && <Loader2 size={13} className="animate-spin" />}
        {pending ? "Saving…" : "Use this key"}
      </Button>
    </div>
  );
}

export function SessionSettings(p: SessionSettingsProps) {
  const [mode, setMode] = useState(p.permissionMode);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [cred, setCred] = useState(p.session.custom_credentials);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void api
      .profiles()
      .then((r) => {
        setProfiles(r.profiles);
        setProfileId(r.active_profile_id);
      })
      .catch(() => {});
  }, []);

  const pickMode = (id: string) => {
    setMode(id);
    void api.setPermissionMode(p.session.id, id);
  };
  const pickProfile = (id: string) => {
    setProfileId(id);
    void api.setSessionProfile(p.session.id, id).catch(() => {});
  };
  const clearKey = () => {
    void api.clearCredential(p.session.id).then(() => setCred(null)).catch(() => {});
  };

  return (
    <Dialog open onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle>Session settings</DialogTitle>
        </DialogHeader>

        <section>
          <div className={heading}>Work mode</div>
          {MODES.map((m) => (
            <button key={m.id} className={row} onClick={() => pickMode(m.id)}>
              <span className="flex flex-col">
                <span className="text-glorp-text">{m.label}</span>
                <span className="text-[12px] text-glorp-muted">{m.hint}</span>
              </span>
              {mode === m.id && <CircleCheck size={16} className="shrink-0 text-glorp-accent" />}
            </button>
          ))}
        </section>

        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-glorp-muted">Model / profile</span>
            <button className="text-[11px] text-glorp-muted hover:text-glorp-text" onClick={p.onClose}>
              Manage models in Settings →
            </button>
          </div>
          {profiles.length === 0 ? (
            <p className="px-2 py-1.5 text-glorp-muted">No profiles configured.</p>
          ) : (
            profiles.map((pr) => (
              <button key={pr.id} className={row} onClick={() => pickProfile(pr.id)}>
                <span className="flex flex-col">
                  <span className="truncate text-glorp-text">{pr.label}</span>
                  <span className="text-[12px] text-glorp-muted">
                    {pr.provider_id} · {pr.model}
                  </span>
                </span>
                {profileId === pr.id && <CircleCheck size={16} className="shrink-0 text-glorp-accent" />}
              </button>
            ))
          )}
        </section>

        <section>
          <div className={heading}>Custom API key</div>
          {cred ? (
            <div className="flex items-center justify-between rounded-md px-2.5 py-2">
              <span className="inline-flex items-center gap-2 text-glorp-text">
                <KeyRound size={16} className="shrink-0 text-glorp-success" />
                {cred.provider} · ····{cred.last4}
              </span>
              <button className="text-[12px] text-glorp-error hover:opacity-80" onClick={clearKey}>
                Remove
              </button>
            </div>
          ) : adding ? (
            <CredentialForm
              sessionId={p.session.id}
              onSaved={(c) => {
                setCred(c);
                setAdding(false);
              }}
            />
          ) : (
            <button
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-glorp-accent hover:bg-glorp-surface-2"
              onClick={() => setAdding(true)}
            >
              <Plus size={16} className="shrink-0" /> Add custom key
            </button>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
