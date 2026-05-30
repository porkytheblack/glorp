/**
 * Right-side slide-over for per-session settings: work mode (permission mode),
 * model profile selection, and a custom API-key override. Mirrors the section
 * styling of EnvironmentPanel and the button/input chrome used across the app.
 */

import { useEffect, useState } from "react";
import { api, type ProfileSummary } from "../api/client.ts";
import type { SessionDto } from "../types.ts";

interface Props {
  sessionId: string;
  session: SessionDto | null;
  open: boolean;
  onClose: () => void;
}

const MODES: { value: string; label: string }[] = [
  { value: "normal", label: "Normal · ask every time" },
  { value: "auto", label: "Auto · approve safe ops" },
  { value: "bypass", label: "Full access · no prompts" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-glorp-border px-3 py-3">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-glorp-muted">{title}</div>
      {children}
    </div>
  );
}

export function SettingsDrawer({ sessionId, session, open, onClose }: Props) {
  const [mode, setMode] = useState(session?.permission_mode ?? "normal");
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [activeProfile, setActiveProfile] = useState<string | null>(null);
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [credModel, setCredModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMode(session?.permission_mode ?? "normal"), [session?.permission_mode]);

  const loadProfiles = () =>
    api.profiles().then((r) => {
      const sessionProfile = r.profiles.find((p) => p.label === session?.model_label)?.id ?? null;
      setProfiles(r.profiles);
      setActiveProfile(sessionProfile ?? r.active_profile_id);
    });

  useEffect(() => {
    if (open) void loadProfiles().catch(() => {});
  }, [open, session?.model_label]);

  if (!open) return null;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const changeMode = (value: string) => {
    setMode(value);
    void run(() => api.setPermissionMode(sessionId, value));
  };

  const activate = (id: string) =>
    run(async () => {
      await api.setSessionProfile(sessionId, id);
      setActiveProfile(id);
    });

  const saveKey = () =>
    run(async () => {
      await api.setCredential(sessionId, provider.trim(), apiKey, credModel.trim() || undefined);
      setApiKey("");
    });

  const cred = session?.custom_credentials ?? null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-glorp-bg/60" onClick={onClose} />
      <aside className="relative h-full w-[360px] overflow-y-auto border-l border-glorp-border bg-glorp-surface">
        <div className="flex items-center justify-between border-b border-glorp-border px-3 py-2.5">
          <span className="font-semibold text-glorp-text">Settings</span>
          <button
            onClick={onClose}
            className="rounded border border-glorp-border px-2 py-0.5 text-xs text-glorp-muted hover:border-glorp-accent hover:text-glorp-accent"
          >
            Close
          </button>
        </div>

        {error && <p className="border-b border-glorp-border px-3 py-2 text-glorp-error">{error}</p>}

        <Section title="Work mode">
          <div className="space-y-1.5">
            {MODES.map((m) => (
              <button
                key={m.value}
                disabled={busy}
                onClick={() => changeMode(m.value)}
                className={`block w-full rounded px-2 py-1.5 text-left text-glorp-text hover:bg-glorp-surface-2 disabled:opacity-50 ${
                  m.value === mode ? "bg-glorp-surface-2 ring-1 ring-glorp-accent" : ""
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Model">
          {profiles.length === 0 ? (
            <p className="text-glorp-muted">No profiles configured.</p>
          ) : (
            <div className="space-y-1.5">
              {profiles.map((p) => (
                <button
                  key={p.id}
                  disabled={busy}
                  onClick={() => void activate(p.id)}
                  className={`flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left hover:bg-glorp-surface-2 disabled:opacity-50 ${
                    p.id === activeProfile ? "bg-glorp-surface-2 ring-1 ring-glorp-accent" : ""
                  }`}
                >
                  <span className="flex items-center gap-2 text-glorp-text">
                    {p.label}
                    {p.id === activeProfile && <span className="text-[11px] text-glorp-accent">active</span>}
                  </span>
                  <span className="text-[11px] text-glorp-muted">{p.model}</span>
                </button>
              ))}
            </div>
          )}
        </Section>

        <Section title="Custom API key">
          {cred && (
            <p className="mb-2 text-glorp-warn">
              {cred.provider} · ••••{cred.last4}
            </p>
          )}
          <div className="space-y-2">
            <input
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="provider (e.g. anthropic)"
              className="w-full rounded border border-glorp-border bg-glorp-bg px-3 py-2 text-glorp-text outline-none focus:border-glorp-accent"
            />
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="API key"
              className="w-full rounded border border-glorp-border bg-glorp-bg px-3 py-2 text-glorp-text outline-none focus:border-glorp-accent"
            />
            <input
              value={credModel}
              onChange={(e) => setCredModel(e.target.value)}
              placeholder="model (optional)"
              className="w-full rounded border border-glorp-border bg-glorp-bg px-3 py-2 text-glorp-text outline-none focus:border-glorp-accent"
            />
            <div className="flex gap-2">
              <button
                disabled={busy || !provider.trim() || !apiKey}
                onClick={saveKey}
                className="rounded bg-glorp-accent-dim px-3 py-1.5 text-glorp-text hover:bg-glorp-accent disabled:opacity-50"
              >
                Set key
              </button>
              <button
                disabled={busy || !cred}
                onClick={() => void run(() => api.clearCredential(sessionId))}
                className="rounded border border-glorp-error px-3 py-1.5 text-glorp-error hover:bg-glorp-error/10 disabled:opacity-50"
              >
                Revert to Station default
              </button>
            </div>
          </div>
        </Section>
      </aside>
    </div>
  );
}
