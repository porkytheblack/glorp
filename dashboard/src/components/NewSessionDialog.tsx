/**
 * Modal for creating a session — replaces the placeholder window.prompt flow.
 * Two modes: from a host directory (with optional provider/model + custom
 * credentials), or from a setup template with a dynamic {param:NAME} form.
 */

import { useEffect, useState } from "react";
import { api, type CreateSessionBody, type TemplateSummary } from "../api/client.ts";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}

type Mode = "directory" | "template";

const FIELD =
  "w-full rounded border border-glorp-border bg-glorp-bg px-3 py-2 text-glorp-text outline-none focus:border-glorp-accent";
const LABEL = "block text-[11px] uppercase tracking-wide text-glorp-muted";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

export function NewSessionDialog({ open, onClose, onCreated }: Props) {
  const [mode, setMode] = useState<Mode>("directory");
  const [workspace, setWorkspace] = useState("");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [showCreds, setShowCreds] = useState(false);
  const [credProvider, setCredProvider] = useState("");
  const [credApiKey, setCredApiKey] = useState("");
  const [credModel, setCredModel] = useState("");
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [paramKeys, setParamKeys] = useState<string[]>([]);
  const [paramVals, setParamVals] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void api.templates().then((r) => setTemplates(r.templates)).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!selected) return;
    setParamKeys([]);
    setParamVals({});
    void fetch(`/templates/${encodeURIComponent(selected)}`)
      .then((r) => r.json())
      .then((d: { template: { steps: Record<string, unknown>[] } }) => {
        const found = new Set<string>();
        const re = /\{param:([^}]+)\}/g;
        for (const m of JSON.stringify(d.template.steps).matchAll(re)) found.add(m[1]);
        setParamKeys([...found]);
      })
      .catch(() => {});
  }, [selected]);

  if (!open) return null;

  const submit = async () => {
    setPending(true);
    setError(null);
    const hasCreds = showCreds && credProvider && credApiKey;
    const creds = hasCreds ? { provider: credProvider, apiKey: credApiKey, ...(credModel ? { model: credModel } : {}) } : undefined;
    const body: CreateSessionBody =
      mode === "template"
        ? { template: selected!, params: paramVals }
        : {
            ...(workspace ? { workspace } : {}),
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(creds ? { credentials: creds } : {}),
          };
    try {
      const result = await api.createSession(body);
      onCreated(result.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const canSubmit = !pending && (mode === "directory" || !!selected);
  const tab = (m: Mode, text: string) => (
    <button
      onClick={() => setMode(m)}
      className={`rounded px-3 py-1 text-xs ${
        mode === m ? "bg-glorp-surface-2 text-glorp-text ring-1 ring-glorp-border" : "text-glorp-muted hover:text-glorp-text"
      }`}
    >
      {text}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-glorp-bg/70" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[480px] flex-col overflow-hidden rounded-lg border border-glorp-border bg-glorp-surface"
      >
        <div className="flex items-center gap-2 border-b border-glorp-border px-4 py-3">
          <span className="mr-auto font-semibold text-glorp-text">New session</span>
          {tab("directory", "Directory")}
          {tab("template", "Template")}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {mode === "directory" ? (
            <>
              <Field label="Workspace path (blank = auto)">
                <input className={FIELD} value={workspace} onChange={(e) => setWorkspace(e.target.value)} placeholder="/abs/path/on/host" />
              </Field>
              <Field label="Provider (optional)">
                <input className={FIELD} value={provider} onChange={(e) => setProvider(e.target.value)} />
              </Field>
              <Field label="Model (optional)">
                <input className={FIELD} value={model} onChange={(e) => setModel(e.target.value)} />
              </Field>
              <button onClick={() => setShowCreds((v) => !v)} className="text-xs text-glorp-accent hover:underline">
                {showCreds ? "− Custom API key" : "+ Custom API key"}
              </button>
              {showCreds && (
                <div className="space-y-3 rounded border border-glorp-border bg-glorp-bg/40 p-3">
                  <Field label="Credential provider">
                    <input className={FIELD} value={credProvider} onChange={(e) => setCredProvider(e.target.value)} />
                  </Field>
                  <Field label="API key">
                    <input type="password" className={FIELD} value={credApiKey} onChange={(e) => setCredApiKey(e.target.value)} />
                  </Field>
                  <Field label="Model (optional)">
                    <input className={FIELD} value={credModel} onChange={(e) => setCredModel(e.target.value)} />
                  </Field>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="space-y-1">
                {templates.length === 0 && <p className="text-glorp-muted">No templates available.</p>}
                {templates.map((t) => (
                  <button
                    key={t.name}
                    onClick={() => setSelected(t.name)}
                    title={t.description ?? undefined}
                    className={`block w-full rounded px-2 py-1.5 text-left hover:bg-glorp-surface-2 ${
                      selected === t.name ? "bg-glorp-surface-2 ring-1 ring-glorp-border" : ""
                    }`}
                  >
                    <span className="text-glorp-text">{t.name}</span>{" "}
                    <span className="text-[11px] text-glorp-muted">{t.step_count} steps</span>
                  </button>
                ))}
              </div>
              {paramKeys.length > 0 && (
                <div className="space-y-3 rounded border border-glorp-border bg-glorp-bg/40 p-3">
                  {paramKeys.map((k) => (
                    <Field key={k} label={k}>
                      <input
                        className={FIELD}
                        value={paramVals[k] ?? ""}
                        onChange={(e) => setParamVals((p) => ({ ...p, [k]: e.target.value }))}
                      />
                    </Field>
                  ))}
                </div>
              )}
            </>
          )}
          {error && <p className="text-glorp-error">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-glorp-border px-4 py-3">
          <button onClick={onClose} className="rounded border border-glorp-border px-3 py-1.5 text-glorp-muted hover:text-glorp-text">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="flex items-center gap-2 rounded bg-glorp-accent-dim px-4 py-1.5 text-glorp-text hover:bg-glorp-accent disabled:opacity-50"
          >
            {pending && <span className="h-3 w-3 animate-spin rounded-full border-2 border-glorp-text border-t-transparent" />}
            {pending ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
