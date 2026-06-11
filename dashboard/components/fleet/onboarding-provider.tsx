"use client";

import * as React from "react";
import { Check, Eye, EyeOff, Plug, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/shared";
import { StepCard } from "./onboarding-shared";
import type { Catalog, CatalogProvider } from "@/lib/types";

const CUSTOM = "__custom__";
const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Step 1 — connect a known provider, or wire a custom OpenAI-compatible endpoint. */
export function ConnectProvider({ catalog, onConnected }: { catalog: Catalog | null; onConnected: (id: string, models: string[]) => void }) {
  const known = catalog?.providers ?? [];
  const [choice, setChoice] = React.useState("");
  const [customName, setCustomName] = React.useState("");
  const [baseURL, setBaseURL] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [reveal, setReveal] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const isCustom = choice === CUSTOM;
  const meta = known.find((p) => p.id === choice);
  const needsKey = isCustom ? true : meta?.needs_api_key ?? true;
  const id = isCustom ? `custom-${slug(customName)}` : choice;
  const ready = isCustom ? Boolean(slug(customName) && baseURL.trim()) : Boolean(choice);

  const connect = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await api("/models/providers", {
        method: "POST",
        body: { id, type: isCustom ? "custom" : "known", apiKey: apiKey.trim() || undefined, baseURL: baseURL.trim() || undefined },
      });
      onConnected(id, meta?.default_models ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the provider");
      setBusy(false);
    }
  };

  return (
    <StepCard title="Connect a provider" subtitle="Choose where your agent's model runs. The key is stored server-side and never returned to the browser.">
      <div className="grid gap-2 sm:grid-cols-2">
        {known.map((p) => (
          <ProviderRow key={p.id} p={p} selected={choice === p.id} onSelect={() => setChoice(p.id)} />
        ))}
        <CustomRow selected={isCustom} onSelect={() => setChoice(CUSTOM)} />
      </div>

      {isCustom && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="my-proxy" />
          </Field>
          <Field label="Base URL" hint="OpenAI-compatible · ends in /v1">
            <Input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="https://…/v1" />
          </Field>
        </div>
      )}

      {choice && needsKey && (
        <Field label="API key">
          <div className="relative">
            <Input type={reveal ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" className="pr-9 font-mono text-[12.5px]" />
            <button type="button" onClick={() => setReveal((r) => !r)} className="absolute inset-y-0 right-0 grid w-9 place-items-center text-faint transition-colors hover:text-foreground" aria-label={reveal ? "Hide key" : "Show key"}>
              {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
        </Field>
      )}

      <div className="flex justify-end pt-1">
        <Button onClick={connect} disabled={!ready || busy}>
          {busy ? <Spinner /> : <Plug />} Continue
        </Button>
      </div>
    </StepCard>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-[13px] font-medium text-foreground">{label}</span>
      {children}
      {hint && <p className="text-[11.5px] text-faint">{hint}</p>}
    </div>
  );
}

function ProviderRow({ p, selected, onSelect }: { p: CatalogProvider; selected: boolean; onSelect: () => void }) {
  return (
    <PickRow selected={selected} onSelect={onSelect}>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-foreground">{p.label}</div>
        <div className="truncate text-[11.5px] text-faint">{p.description}</div>
      </div>
    </PickRow>
  );
}

function CustomRow({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  return (
    <PickRow selected={selected} onSelect={onSelect}>
      <SlidersHorizontal className="size-4 shrink-0 text-faint" />
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-foreground">Custom endpoint</div>
        <div className="text-[11.5px] text-faint">Any OpenAI-compatible API</div>
      </div>
    </PickRow>
  );
}

function PickRow({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
        selected ? "border-brand/50 bg-brand/[0.07]" : "border-border bg-surface-2/30 hover:border-border-strong hover:bg-surface-2",
      )}
    >
      <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border transition-colors", selected ? "border-brand bg-brand text-brand-foreground" : "border-border-strong")}>
        {selected && <Check className="size-2.5" />}
      </span>
      {children}
    </button>
  );
}
