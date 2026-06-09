"use client";

/** Add-provider modal: guided for known providers, full control for custom
 * OpenAI-compatible endpoints (adapter, basedOn, context limit). */

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Modal, Field } from "@/components/ui";
import type { Catalog } from "@/lib/types";

interface Props {
  catalog: Catalog | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}

export function AddProviderModal({ catalog, onClose, onSaved }: Props) {
  const known = catalog?.providers ?? [];
  const adapters = catalog?.adapters ?? [];

  // "" while nothing is picked; a known id; or "__custom__" for a custom endpoint.
  const [choice, setChoice] = useState("");
  const isCustom = choice === "__custom__";
  const knownMeta = useMemo(() => known.find((p) => p.id === choice), [known, choice]);

  const [customId, setCustomId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [adapter, setAdapter] = useState(adapters[0]?.id ?? "openai-compat");
  const [basedOn, setBasedOn] = useState("");
  const [contextLimit, setContextLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const id = isCustom ? customId.trim() : choice;
  const needsKey = isCustom ? false : knownMeta?.needs_api_key ?? true;

  const save = async () => {
    setErr(null);
    if (!id) { setErr("Pick a provider or enter a custom id."); return; }
    setBusy(true);
    try {
      await api("/models/providers", {
        method: "POST",
        body: {
          id,
          type: isCustom ? "custom" : "known",
          apiKey: apiKey.trim() || undefined,
          baseURL: baseURL.trim() || undefined,
          ...(isCustom ? { adapter } : {}),
          ...(isCustom && basedOn ? { basedOn } : {}),
          ...(contextLimit.trim() ? { contextLimit: Number(contextLimit) } : {}),
        },
      });
      onSaved("Provider saved");
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save provider");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add provider" onClose={onClose} onSubmit={save} busy={busy} submitLabel="Save">
      <Field label="Provider">
        <select className="select" autoFocus value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Select a provider…</option>
          {known.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
          <option value="__custom__">Custom (OpenAI-compatible endpoint)…</option>
        </select>
      </Field>
      {knownMeta && (
        <p className="sub" style={{ marginTop: -4 }}>
          {knownMeta.description}{knownMeta.env_var ? ` · env: ${knownMeta.env_var}` : ""}
        </p>
      )}

      {isCustom && (
        <>
          <Field label="Provider id">
            <input className="input" placeholder="my-proxy" value={customId} onChange={(e) => setCustomId(e.target.value)} />
          </Field>
          <Field label="Adapter">
            <select className="select" value={adapter} onChange={(e) => setAdapter(e.target.value)}>
              {adapters.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </Field>
          <Field label="Based on (inherit a known provider's defaults — optional)">
            <select className="select" value={basedOn} onChange={(e) => setBasedOn(e.target.value)}>
              <option value="">none</option>
              {known.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Field>
        </>
      )}

      <Field label={`API key${needsKey ? "" : " (optional)"}`}>
        <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      </Field>
      <Field label={`Base URL${isCustom ? "" : " (override — optional)"}`}>
        <input className="input" placeholder="https://…/v1" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} />
      </Field>
      <Field label="Context limit (tokens — optional)">
        <input className="input" inputMode="numeric" placeholder="e.g. 200000" value={contextLimit} onChange={(e) => setContextLimit(e.target.value)} />
      </Field>

      {err && <p className="sub" style={{ color: "var(--danger, #e5544b)" }}>{err}</p>}
    </Modal>
  );
}
