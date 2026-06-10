"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldRow, ModalFooter } from "./form";
import type { ProviderWire } from "@/lib/types";

/** Update an existing provider's API key (and optionally base URL / context
 * limit). Other fields are preserved server-side, so leaving the key blank
 * keeps the current one. */
export function EditProviderModal({ provider, onSaved }: { provider: ProviderWire; onSaved: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [apiKey, setApiKey] = React.useState("");
  const [baseURL, setBaseURL] = React.useState(provider.base_url ?? "");
  const [contextLimit, setContextLimit] = React.useState(provider.context_limit ? String(provider.context_limit) : "");
  const [busy, setBusy] = React.useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api("/models/providers", {
        method: "POST",
        body: {
          id: provider.id,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(baseURL.trim() ? { baseURL: baseURL.trim() } : {}),
          ...(contextLimit.trim() ? { contextLimit: Number(contextLimit) } : {}),
        },
      });
      toast.success("Provider updated");
      onSaved();
      setOpen(false);
      setApiKey("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
        <div className="space-y-4">
          <Field label="API key">
            <Input
              type="password"
              autoFocus
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
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
        </div>
        <ModalFooter onCancel={() => setOpen(false)} onSubmit={save} submitLabel="Save" busy={busy} />
      </DialogContent>
    </Dialog>
  );
}
