"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { verifyProvider } from "@/lib/verify-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldRow, KeyInput, ModalFooter, VerifyBanner } from "./form";
import type { ProviderWire } from "@/lib/types";

type Verdict = { ok: true; models: number } | { ok: false; message: string };

/** Update an existing provider's API key (and optionally base URL / context
 * limit). Other fields are preserved server-side, so leaving the key blank
 * keeps the current one. A rotated key is verified live after saving. */
export function EditProviderModal({ provider, onSaved }: { provider: ProviderWire; onSaved: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [apiKey, setApiKey] = React.useState("");
  const [baseURL, setBaseURL] = React.useState(provider.base_url ?? "");
  const [contextLimit, setContextLimit] = React.useState(provider.context_limit ? String(provider.context_limit) : "");
  const [busy, setBusy] = React.useState(false);
  const [verdict, setVerdict] = React.useState<Verdict | null>(null);

  const rotated = apiKey.trim().length > 0;

  const save = async () => {
    setBusy(true);
    setVerdict(null);
    try {
      await api("/models/providers", {
        method: "POST",
        body: {
          id: provider.id,
          ...(rotated ? { apiKey: apiKey.trim() } : {}),
          ...(baseURL.trim() ? { baseURL: baseURL.trim() } : {}),
          ...(contextLimit.trim() ? { contextLimit: Number(contextLimit) } : {}),
        },
      });
      onSaved();
      if (!rotated) {
        toast.success("Provider updated");
        setOpen(false);
        return;
      }
      const v = await verifyProvider(provider.id);
      if (v.ok) {
        setVerdict({ ok: true, models: v.models.length });
        setApiKey("");
        setTimeout(() => setOpen(false), 900);
      } else {
        setVerdict({ ok: false, message: v.message });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const failed = verdict && !verdict.ok;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setApiKey(""); setVerdict(null); } }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" title="Edit provider">
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {provider.id}</DialogTitle>
          <DialogDescription>Rotate the API key or adjust the endpoint. Anything left blank keeps its current value.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <Field label="API key">
            <KeyInput
              autoFocus
              value={apiKey}
              onChange={setApiKey}
              placeholder={provider.has_api_key ? "•••• stored — leave blank to keep" : "Set an API key"}
            />
          </Field>
          <FieldRow>
            <Field label="Base URL">
              <Input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="https://…/v1" />
            </Field>
            <Field label="Context limit">
              <Input inputMode="numeric" value={contextLimit} onChange={(e) => setContextLimit(e.target.value)} placeholder="e.g. 200000" />
            </Field>
          </FieldRow>
          {verdict && <VerifyBanner state={verdict} />}
        </div>
        {failed ? (
          <div className="flex justify-end gap-2 sm:flex-row">
            <Button variant="ghost" onClick={() => setOpen(false)}>Keep anyway</Button>
            <Button onClick={() => setVerdict(null)}>Fix key</Button>
          </div>
        ) : (
          <ModalFooter onCancel={() => setOpen(false)} onSubmit={save} submitLabel="Save" busy={busy} disabled={!!verdict} />
        )}
      </DialogContent>
    </Dialog>
  );
}
