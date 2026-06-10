"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Field, ModalFooter } from "./form";
import type { ProfileWire, ReasoningOption } from "@/lib/types";

/** Change a profile's reasoning effort in place (mirrors the TUI `r` cycle):
 * one model entry, with reasoning as an editable attribute — not a duplicate. */
export function EditReasoningModal({ profile, onSaved }: { profile: ProfileWire; onSaved: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [opts, setOpts] = React.useState<ReasoningOption[] | null>(null);
  const [idx, setIdx] = React.useState("0");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setOpts(null);
    const q = `?provider=${encodeURIComponent(profile.provider_id)}&model=${encodeURIComponent(profile.model)}`;
    api<{ options: ReasoningOption[] }>(`/models/reasoning-options${q}`)
      .then((r) => {
        setOpts(r.options);
        const cur = JSON.stringify(profile.reasoning ?? { kind: "off" });
        const found = r.options.findIndex((o) => JSON.stringify(o.value) === cur);
        setIdx(String(found >= 0 ? found : 0));
      })
      .catch(() => setOpts([]));
  }, [open, profile.provider_id, profile.model, profile.reasoning]);

  const save = async () => {
    if (!opts) return;
    setBusy(true);
    try {
      await api(`/models/profiles/${profile.id}/reasoning`, { method: "POST", body: { reasoning: opts[Number(idx)]?.value ?? { kind: "off" } } });
      toast.success("Reasoning updated");
      onSaved();
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground" title="Reasoning effort">
          <Sparkles /> Reasoning
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reasoning effort</DialogTitle>
          <DialogDescription>
            {profile.provider_id} · <span className="font-mono">{profile.model}</span> — sets the thinking effort this model uses.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {opts === null ? (
            <div className="flex items-center justify-center gap-2.5 py-6 text-[13px] text-muted-foreground">
              <Spinner /> Loading effort levels…
            </div>
          ) : opts.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface-2/40 px-4 py-3 text-[13px] text-muted-foreground">
              This model doesn’t expose reasoning controls.
            </p>
          ) : (
            <Field label="Effort">
              <Select value={idx} onValueChange={setIdx}>
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
            </Field>
          )}
        </div>
        <ModalFooter onCancel={() => setOpen(false)} onSubmit={save} submitLabel="Save" busy={busy} disabled={!opts || opts.length === 0} />
      </DialogContent>
    </Dialog>
  );
}
