"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { verifyProvider } from "@/lib/verify-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Field, FieldRow, KeyInput, ModalFooter, VerifyBanner, slugify } from "./form";
import type { Catalog } from "@/lib/types";

const CUSTOM = "__custom__";
const NONE = "__none__";
type Verdict = { ok: true; models: number } | { ok: false; message: string };

export function AddProviderModal({ catalog, onSaved }: { catalog: Catalog | null; onSaved: () => void }) {
  const known = catalog?.providers ?? [];
  const adapters = catalog?.adapters ?? [];

  const [open, setOpen] = React.useState(false);
  const [choice, setChoice] = React.useState("");
  const [name, setName] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [baseURL, setBaseURL] = React.useState("");
  const [adapter, setAdapter] = React.useState(adapters[0]?.id ?? "openai-compat");
  const [basedOn, setBasedOn] = React.useState(NONE);
  const [contextLimit, setContextLimit] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [verdict, setVerdict] = React.useState<Verdict | null>(null);

  const isCustom = choice === CUSTOM;
  const meta = known.find((p) => p.id === choice);
  const slug = slugify(name);
  const id = isCustom ? (slug ? `custom-${slug}` : "") : choice;
  const needsKey = isCustom ? false : meta?.needs_api_key ?? true;

  React.useEffect(() => {
    if (!open) {
      setChoice(""); setName(""); setApiKey(""); setBaseURL(""); setBasedOn(NONE); setContextLimit(""); setVerdict(null);
    }
  }, [open]);

  const save = async () => {
    if (!id) {
      toast.error(isCustom ? "Name the custom endpoint." : "Pick a provider.");
      return;
    }
    setBusy(true);
    setVerdict(null);
    try {
      await api("/models/providers", {
        method: "POST",
        body: {
          id,
          type: isCustom ? "custom" : "known",
          apiKey: apiKey.trim() || undefined,
          baseURL: isCustom ? baseURL.trim() || undefined : undefined,
          ...(isCustom ? { adapter } : {}),
          ...(isCustom && basedOn !== NONE ? { basedOn } : {}),
          ...(contextLimit.trim() ? { contextLimit: Number(contextLimit) } : {}),
        },
      });
      onSaved();
      const v = await verifyProvider(id);
      if (v.ok) {
        setVerdict({ ok: true, models: v.models.length });
        setTimeout(() => setOpen(false), 900);
      } else {
        setVerdict({ ok: false, message: v.message });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save provider");
    } finally {
      setBusy(false);
    }
  };

  const failed = verdict && !verdict.ok;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Plus /> Add provider
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add provider</DialogTitle>
          <DialogDescription>Pick a known provider, or wire up a custom OpenAI-compatible endpoint.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <Field label="Provider" hint={meta?.description}>
            <Select value={choice} onValueChange={(v) => { setChoice(v); setVerdict(null); }}>
              <SelectTrigger>
                <SelectValue placeholder="Select a provider…" />
              </SelectTrigger>
              <SelectContent>
                {known.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
                <SelectItem value={CUSTOM}>Custom (OpenAI-compatible)…</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {isCustom && (
            <FieldRow>
              <Field label="Name" hint={id ? <>id: <span className="font-mono text-faint">{id}</span></> : "Becomes custom-<slug>"}>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My proxy" />
              </Field>
              <Field label="Adapter" hint="OpenAI-compatible">
                <Select value={adapter} onValueChange={setAdapter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {adapters.map((a) => (<SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </Field>
            </FieldRow>
          )}

          {(choice || isCustom) && (
            <Field
              label={needsKey ? "API key" : "API key (optional)"}
              hint={!isCustom && meta?.env_var ? <>Usually the key from <span className="font-mono">${meta.env_var}</span>.</> : undefined}
            >
              <KeyInput value={apiKey} onChange={setApiKey} placeholder={needsKey ? "Paste the API key" : "Leave blank if none"} />
            </Field>
          )}

          {isCustom && (
            <>
              <Field label="Base URL">
                <Input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="https://…/v1" />
              </Field>
              <FieldRow>
                <Field label="Based on" hint="Borrow a known provider's models">
                  <Select value={basedOn} onValueChange={setBasedOn}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {known.map((p) => (<SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Context limit">
                  <Input inputMode="numeric" value={contextLimit} onChange={(e) => setContextLimit(e.target.value)} placeholder="e.g. 200000" />
                </Field>
              </FieldRow>
            </>
          )}

          {verdict && <VerifyBanner state={verdict} />}
        </div>

        {failed ? (
          <div className="flex justify-end gap-2 sm:flex-row">
            <Button variant="ghost" onClick={() => setOpen(false)}>Keep anyway</Button>
            <Button onClick={() => setVerdict(null)}>Fix key</Button>
          </div>
        ) : (
          <ModalFooter onCancel={() => setOpen(false)} onSubmit={save} submitLabel="Save provider" busy={busy} disabled={!!verdict} />
        )}
      </DialogContent>
    </Dialog>
  );
}
