/**
 * Inline add-flows for the Models section: AddProvider (pick a known provider
 * from `api.catalog()` or a custom OpenAI-compatible endpoint → `addProvider`)
 * and AddProfile (pick a configured provider + model → `addProfile`). Split out
 * of Configuration.tsx so each file stays small. LABEL is re-exported for
 * Configuration's section labels.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { api, type CatalogProvider, type ProviderSummary } from "../../../api/client.ts";

export const LABEL = "block text-[11px] font-medium uppercase tracking-wider text-glorp-muted";
export const SECONDARY =
  "inline-flex items-center gap-1.5 rounded-lg border border-glorp-border px-3 py-1.5 text-[12px] text-glorp-text hover:bg-glorp-surface-2 disabled:opacity-50";

const CARD = "space-y-2.5 rounded-lg border border-glorp-border bg-glorp-surface/40 p-3.5";

export function AddProvider(p: {
  catalog: CatalogProvider[];
  onAdded: () => void;
  onError: (m: string) => void;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [customId, setCustomId] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [pending, setPending] = useState(false);
  const known = p.catalog.find((c) => c.id === choice);
  const custom = choice === "__custom__";
  const ready = custom ? customId.trim() !== "" && baseURL.trim() !== "" : known != null;

  const submit = async () => {
    setPending(true);
    p.onError("");
    try {
      if (custom) {
        await api.addProvider({ id: customId.trim(), type: "custom", baseURL: baseURL.trim(), apiKey: apiKey.trim() || undefined });
      } else if (known) {
        await api.addProvider({ id: known.id, type: "known", apiKey: apiKey.trim() || undefined });
      }
      p.onAdded();
      p.onClose();
    } catch (e) {
      p.onError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={CARD}>
      <div className="space-y-1">
        <span className={LABEL}>Provider</span>
        <Select value={choice} onValueChange={setChoice}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a provider…" />
          </SelectTrigger>
          <SelectContent>
            {p.catalog.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
            <SelectItem value="__custom__">Custom (OpenAI-compatible)…</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {known && <p className="text-[12px] leading-snug text-glorp-muted">{known.description}</p>}
      {custom && (
        <>
          <div className="space-y-1">
            <span className={LABEL}>Provider id</span>
            <Input value={customId} onChange={(e) => setCustomId(e.target.value)} placeholder="my-provider" />
          </div>
          <div className="space-y-1">
            <span className={LABEL}>Base URL</span>
            <Input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="https://api.example.com/v1" />
          </div>
        </>
      )}
      {(custom || known?.needs_api_key) && (
        <div className="space-y-1">
          <span className={LABEL}>API key</span>
          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" autoComplete="off" />
        </div>
      )}
      <div className="flex items-center justify-end gap-2 pt-0.5">
        <Button variant="outline" size="sm" onClick={p.onClose}>
          Cancel
        </Button>
        <Button size="sm" disabled={!ready || pending} onClick={() => void submit()}>
          {pending && <Loader2 size={13} className="animate-spin" />}
          {pending ? "Adding…" : "Add provider"}
        </Button>
      </div>
    </div>
  );
}

export function AddProfile(p: {
  providers: ProviderSummary[];
  catalog: CatalogProvider[];
  onAdded: () => void;
  onError: (m: string) => void;
  onClose: () => void;
}) {
  const [providerId, setProviderId] = useState(p.providers[0]?.id ?? "");
  const [model, setModel] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [label, setLabel] = useState("");
  const [activate, setActivate] = useState(false);
  const [pending, setPending] = useState(false);
  const models = p.catalog.find((c) => c.id === providerId)?.default_models ?? [];
  const isCustom = model === "__custom__";
  const finalModel = (isCustom ? customModel : model).trim();
  const ready = providerId !== "" && finalModel !== "";

  const submit = async () => {
    setPending(true);
    p.onError("");
    try {
      await api.addProfile({ providerId, model: finalModel, label: label.trim() || undefined, activate });
      p.onAdded();
      p.onClose();
    } catch (e) {
      p.onError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={CARD}>
      <div className="space-y-1">
        <span className={LABEL}>Provider</span>
        <Select
          value={providerId}
          onValueChange={(v) => {
            setProviderId(v);
            setModel("");
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Choose a provider…" />
          </SelectTrigger>
          <SelectContent>
            {p.providers.map((pr) => (
              <SelectItem key={pr.id} value={pr.id}>
                {pr.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <span className={LABEL}>Model</span>
        <Select value={model} onValueChange={setModel}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a model…" />
          </SelectTrigger>
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
            <SelectItem value="__custom__">Custom model id…</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {isCustom && (
        <Input value={customModel} onChange={(e) => setCustomModel(e.target.value)} placeholder="provider/model-id" />
      )}
      <div className="space-y-1">
        <span className={LABEL}>Label (optional)</span>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Defaults to the model id" />
      </div>
      <label className="flex items-center gap-2 text-[13px] text-glorp-text">
        <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} className="accent-glorp-accent" />
        Make this the Station default
      </label>
      <div className="flex items-center justify-end gap-2 pt-0.5">
        <Button variant="outline" size="sm" onClick={p.onClose}>
          Cancel
        </Button>
        <Button size="sm" disabled={!ready || pending} onClick={() => void submit()}>
          {pending && <Loader2 size={13} className="animate-spin" />}
          {pending ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </div>
  );
}
