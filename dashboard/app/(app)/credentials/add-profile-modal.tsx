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
import type { Catalog, ProviderWire, ReasoningOption } from "@/lib/types";

const isOff = (v: unknown) => typeof v === "object" && v !== null && (v as { kind?: string }).kind === "off";

export function AddProfileModal({ providers, catalog, onSaved }: { providers: ProviderWire[]; catalog: Catalog | null; onSaved: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [providerId, setProviderId] = React.useState("");
  const [model, setModel] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [contextLimit, setContextLimit] = React.useState("");
  const [opts, setOpts] = React.useState<ReasoningOption[]>([]);
  const [reasoningIdx, setReasoningIdx] = React.useState("0");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open && !providerId && providers[0]) setProviderId(providers[0].id);
  }, [open, providers, providerId]);

  const suggestions = React.useMemo(() => {
    const prov = providers.find((p) => p.id === providerId);
    const key = prov?.based_on ?? providerId;
    return catalog?.providers.find((c) => c.id === key)?.default_models ?? [];
  }, [providers, catalog, providerId]);

  React.useEffect(() => {
    setReasoningIdx("0");
    if (!providerId || !model.trim()) {
      setOpts([]);
      return;
    }
    let cancelled = false;
    const q = `?provider=${encodeURIComponent(providerId)}&model=${encodeURIComponent(model.trim())}`;
    api<{ options: ReasoningOption[] }>(`/models/reasoning-options${q}`)
      .then((r) => !cancelled && setOpts(r.options))
      .catch(() => !cancelled && setOpts([]));
    return () => {
      cancelled = true;
    };
  }, [providerId, model]);

  const save = async () => {
    if (!providerId || !model.trim()) {
      toast.error("Provider and model are required.");
      return;
    }
    const reasoning = opts[Number(reasoningIdx)]?.value;
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
      toast.success("Profile added & activated");
      onSaved();
      setOpen(false);
      setModel("");
      setLabel("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add profile");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" disabled={providers.length === 0}>
          <Plus /> Add profile
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add model profile</DialogTitle>
          <DialogDescription>Pair a provider with a model. Reasoning options adapt to what the model supports.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Provider</Label>
              <Select value={providerId} onValueChange={setProviderId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Model</Label>
              <Input list="model-suggestions" value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-sonnet-4-6" />
              <datalist id="model-suggestions">
                {suggestions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
          </div>

          {opts.length > 0 && (
            <div className="space-y-1.5">
              <Label>Reasoning / thinking</Label>
              <Select value={reasoningIdx} onValueChange={setReasoningIdx}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {opts.map((o, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {o.label}
                      {o.description ? ` — ${o.description}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Label (optional)</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`${providerId || "provider"} · ${model || "model"}`} />
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
            {busy ? <Spinner /> : null} Add profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
