"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { Catalog } from "@/lib/types";

const CUSTOM = "__custom__";
const NONE = "__none__";

export function AddProviderModal({ catalog, onSaved }: { catalog: Catalog | null; onSaved: () => void }) {
  const known = catalog?.providers ?? [];
  const adapters = catalog?.adapters ?? [];

  const [open, setOpen] = React.useState(false);
  const [choice, setChoice] = React.useState("");
  const [customId, setCustomId] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [baseURL, setBaseURL] = React.useState("");
  const [adapter, setAdapter] = React.useState(adapters[0]?.id ?? "openai-compat");
  const [basedOn, setBasedOn] = React.useState(NONE);
  const [contextLimit, setContextLimit] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const isCustom = choice === CUSTOM;
  const meta = known.find((p) => p.id === choice);
  const id = isCustom ? customId.trim() : choice;
  const needsKey = isCustom ? false : meta?.needs_api_key ?? true;

  const save = async () => {
    if (!id) {
      toast.error("Pick a provider or enter a custom id.");
      return;
    }
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
          ...(isCustom && basedOn !== NONE ? { basedOn } : {}),
          ...(contextLimit.trim() ? { contextLimit: Number(contextLimit) } : {}),
        },
      });
      toast.success("Provider saved");
      onSaved();
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save provider");
    } finally {
      setBusy(false);
    }
  };

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

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger>
                <SelectValue placeholder="Select a provider…" />
              </SelectTrigger>
              <SelectContent>
                {known.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM}>Custom (OpenAI-compatible)…</SelectItem>
              </SelectContent>
            </Select>
            {meta && <p className="text-[12px] text-muted-foreground">{meta.description}{meta.env_var ? ` · env: ${meta.env_var}` : ""}</p>}
          </div>

          {isCustom && (
            <>
              <div className="space-y-1.5">
                <Label>Provider id</Label>
                <Input value={customId} onChange={(e) => setCustomId(e.target.value)} placeholder="my-proxy" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Adapter</Label>
                  <Select value={adapter} onValueChange={setAdapter}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {adapters.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Based on</Label>
                  <Select value={basedOn} onValueChange={setBasedOn}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>none</SelectItem>
                      {known.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label>{needsKey ? "API key" : "API key (optional)"}</Label>
            <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{isCustom ? "Base URL" : "Base URL (optional)"}</Label>
              <Input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="https://…/v1" />
            </div>
            <div className="space-y-1.5">
              <Label>Context limit</Label>
              <Input inputMode="numeric" value={contextLimit} onChange={(e) => setContextLimit(e.target.value)} placeholder="e.g. 200000" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? <Spinner /> : null} Save provider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
