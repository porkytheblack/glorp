"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
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
        {opts === null ? (
          <div className="py-4">
            <Spinner />
          </div>
        ) : opts.length === 0 ? (
          <p className="py-2 text-[13px] text-muted-foreground">This model doesn’t expose reasoning controls.</p>
        ) : (
          <div className="space-y-1.5">
            <Label>Effort</Label>
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
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !opts || opts.length === 0}>
            {busy ? <Spinner /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
