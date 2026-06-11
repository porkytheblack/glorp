"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Field, FieldRow, ModalFooter } from "./form";
import { ModelCombobox } from "./model-combobox";
import type { Catalog, ProviderWire } from "@/lib/types";

/** Add a (provider, model) profile. Reasoning effort is configured afterwards on
 * the profile row — so a model stays a single entry, the way the TUI works. */
export function AddProfileModal({ providers, catalog, onSaved }: { providers: ProviderWire[]; catalog: Catalog | null; onSaved: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [providerId, setProviderId] = React.useState("");
  const [model, setModel] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open && !providerId && providers[0]) setProviderId(providers[0].id);
  }, [open, providers, providerId]);

  const suggestions = React.useMemo(() => {
    const prov = providers.find((p) => p.id === providerId);
    const key = prov?.based_on ?? providerId;
    return catalog?.providers.find((c) => c.id === key)?.default_models ?? [];
  }, [providers, catalog, providerId]);


  const save = async () => {
    if (!providerId || !model.trim()) {
      toast.error("Provider and model are required.");
      return;
    }
    setBusy(true);
    try {
      await api("/models/profiles", {
        method: "POST",
        body: {
          providerId,
          model: model.trim(),
          label: label.trim() || undefined,
          activate: true,
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
          <Plus /> Add model
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add model</DialogTitle>
          <DialogDescription>Pair a provider with a model. Set reasoning effort afterwards from the model’s row.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <FieldRow>
            <Field label="Provider">
              <Select
                value={providerId}
                onValueChange={(id) => {
                  setProviderId(id);
                  setModel("");
                }}
              >
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
            </Field>
            <Field label="Model">
              <ModelCombobox providerId={providerId} catalog={suggestions} value={model} onChange={setModel} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Label (optional)">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`${providerId || "provider"} · ${model || "model"}`} />
            </Field>
            <Field label="Context window" hint="Detected automatically from the model catalog. Override per provider under its edit dialog if needed.">
              <div className="flex h-9 items-center rounded-md border border-border/60 bg-surface-2/40 px-3 text-[13px] text-muted-foreground">Auto</div>
            </Field>
          </FieldRow>
        </div>

        <ModalFooter onCancel={() => setOpen(false)} onSubmit={save} submitLabel="Add model" busy={busy} />
      </DialogContent>
    </Dialog>
  );
}
