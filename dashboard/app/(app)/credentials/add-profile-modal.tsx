"use client";

/** Add-profile modal: pick a configured provider, choose/type a model (with
 * catalog suggestions), optionally set a label + reasoning effort + context
 * limit, and activate. Reasoning options are fetched per (provider, model) so
 * the picker matches exactly what the model supports. */

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Modal, Field } from "@/components/ui";
import type { Catalog, ProviderWire, ReasoningOption } from "@/lib/types";

interface Props {
  providers: ProviderWire[];
  catalog: Catalog | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}

const isOff = (v: unknown): boolean =>
  typeof v === "object" && v !== null && (v as { kind?: string }).kind === "off";

export function AddProfileModal({ providers, catalog, onClose, onSaved }: Props) {
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [model, setModel] = useState("");
  const [label, setLabel] = useState("");
  const [contextLimit, setContextLimit] = useState("");
  const [reasoningOpts, setReasoningOpts] = useState<ReasoningOption[]>([]);
  const [reasoningIdx, setReasoningIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Catalog suggestions follow the provider's effective known id (based_on for
  // custom endpoints), so a custom provider still offers sensible model names.
  const suggestions = useMemo(() => {
    const prov = providers.find((p) => p.id === providerId);
    const key = prov?.based_on ?? providerId;
    return catalog?.providers.find((c) => c.id === key)?.default_models ?? [];
  }, [providers, catalog, providerId]);

  // Fetch the reasoning options for the current (provider, model) pair.
  useEffect(() => {
    setReasoningIdx(0);
    if (!providerId || !model.trim()) { setReasoningOpts([]); return; }
    let cancelled = false;
    const q = `?provider=${encodeURIComponent(providerId)}&model=${encodeURIComponent(model.trim())}`;
    api<{ options: ReasoningOption[] }>(`/models/reasoning-options${q}`)
      .then((r) => !cancelled && setReasoningOpts(r.options))
      .catch(() => !cancelled && setReasoningOpts([]));
    return () => { cancelled = true; };
  }, [providerId, model]);

  const save = async () => {
    setErr(null);
    if (!providerId || !model.trim()) { setErr("Provider and model are required."); return; }
    const reasoning = reasoningOpts[reasoningIdx]?.value;
    setBusy(true);
    try {
      await api("/models/profiles", {
        method: "POST",
        body: {
          providerId,
          model: model.trim(),
          label: label.trim() || undefined,
          activate: true,
          ...(reasoning && !isOff(reasoning) ? { reasoning } : {}),
          ...(contextLimit.trim() ? { contextLimit: Number(contextLimit) } : {}),
        },
      });
      onSaved("Profile added & activated");
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add profile");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add model profile" onClose={onClose} onSubmit={save} busy={busy} submitLabel="Add">
      <Field label="Provider">
        {providers.length === 0 ? (
          <p className="sub">Add a provider first.</p>
        ) : (
          <select className="select" autoFocus value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
          </select>
        )}
      </Field>
      <Field label="Model">
        <input
          className="input"
          list="model-suggestions"
          placeholder="claude-sonnet-4-6"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
        <datalist id="model-suggestions">
          {suggestions.map((m) => <option key={m} value={m} />)}
        </datalist>
      </Field>
      {reasoningOpts.length > 0 && (
        <Field label="Reasoning / thinking">
          <select className="select" value={reasoningIdx} onChange={(e) => setReasoningIdx(Number(e.target.value))}>
            {reasoningOpts.map((o, i) => (
              <option key={i} value={i}>{o.label}{o.description ? ` — ${o.description}` : ""}</option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Label (optional)">
        <input className="input" placeholder={`${providerId} · ${model || "model"}`} value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label="Context limit (tokens — optional)">
        <input className="input" inputMode="numeric" placeholder="e.g. 200000" value={contextLimit} onChange={(e) => setContextLimit(e.target.value)} />
      </Field>
      {err && <p className="sub" style={{ color: "var(--danger, #e5544b)" }}>{err}</p>}
    </Modal>
  );
}
