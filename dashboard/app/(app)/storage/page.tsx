"use client";

import * as React from "react";
import { Cloud, Save } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@/lib/hooks";
import { api } from "@/lib/api";
import { Page, PageHeader, Loading, ErrorState, Spinner } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toggle } from "./toggle";
import type { StorageConfigDto, UpdateStorageConfigInput } from "@/lib/types";

const EMPTY: StorageConfigDto = {
  enabled: false,
  endpoint: null,
  bucket: null,
  prefix: null,
  access_key_id: null,
  has_secret: false,
};

/** A labeled text field, stacked label over input with an optional hint. */
function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={mono ? "font-mono text-[12.5px]" : undefined} />
      {hint && <p className="text-[12px] leading-relaxed text-faint">{hint}</p>}
    </div>
  );
}

export default function StoragePage() {
  const { data, loading, error, reload } = useQuery<{ storage: StorageConfigDto }>("/storage");
  const config = data?.storage ?? EMPTY;

  const [enabled, setEnabled] = React.useState(false);
  const [endpoint, setEndpoint] = React.useState("");
  const [bucket, setBucket] = React.useState("");
  const [prefix, setPrefix] = React.useState("");
  const [accessKey, setAccessKey] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [replacingSecret, setReplacingSecret] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // Hydrate the form whenever the server config (re)loads.
  React.useEffect(() => {
    setEnabled(config.enabled);
    setEndpoint(config.endpoint ?? "");
    setBucket(config.bucket ?? "");
    setPrefix(config.prefix ?? "");
    setAccessKey(config.access_key_id ?? "");
    setSecret("");
    setReplacingSecret(false);
  }, [config.enabled, config.endpoint, config.bucket, config.prefix, config.access_key_id, config.has_secret]);

  const save = async () => {
    const patch: UpdateStorageConfigInput = {};
    if (enabled !== config.enabled) patch.enabled = enabled;
    if (endpoint.trim() !== (config.endpoint ?? "")) patch.endpoint = endpoint.trim() || null;
    if (bucket.trim() !== (config.bucket ?? "")) patch.bucket = bucket.trim() || null;
    if (prefix.trim() !== (config.prefix ?? "")) patch.prefix = prefix.trim() || null;
    if (accessKey.trim() !== (config.access_key_id ?? "")) patch.access_key_id = accessKey.trim() || null;
    // Secret is write-only: send it only when the user typed a new one.
    if ((!config.has_secret || replacingSecret) && secret) patch.secret_access_key = secret;

    if (Object.keys(patch).length === 0) {
      toast.message("No changes to save");
      return;
    }
    setBusy(true);
    try {
      await api("/storage", { method: "PUT", body: patch });
      toast.success("Storage settings saved");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <PageHeader
        title="Storage"
        description="Mirror each session's uploads/ folder to an S3-compatible bucket (Cloudflare R2 or any S3 endpoint) so your other systems can reach the same files."
      />

      {error && <ErrorState message={error} className="mb-4" />}

      {loading ? (
        <Loading />
      ) : (
        <div className="surface max-w-xl space-y-5 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
                <Cloud className="size-4 text-faint" /> Remote uploads mirror
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-faint">
                Files sync under <span className="font-mono text-muted-foreground">{prefix.trim() ? `${prefix.trim()}/` : ""}&lt;namespace&gt;/&lt;session&gt;/</span>.
                Local files stay canonical while a session is live.
              </p>
            </div>
            <Toggle checked={enabled} onChange={setEnabled} label="Enable remote storage" disabled={busy} />
          </div>

          <div className="grid gap-4 border-t border-border/60 pt-5">
            <TextField label="Endpoint" value={endpoint} onChange={setEndpoint} mono placeholder="https://<account>.r2.cloudflarestorage.com" />
            <div className="grid grid-cols-2 gap-4">
              <TextField label="Bucket" value={bucket} onChange={setBucket} placeholder="my-uploads" />
              <TextField label="Prefix" value={prefix} onChange={setPrefix} placeholder="(optional)" hint="Key prefix inside the bucket." />
            </div>
            <TextField label="Access key ID" value={accessKey} onChange={setAccessKey} mono placeholder="R2 / S3 access key id" />
            <div className="space-y-1.5">
              <Label>Secret access key</Label>
              {config.has_secret && !replacingSecret ? (
                <div className="flex items-center justify-between rounded-md border border-border bg-surface-2/60 px-3 py-2">
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                    <span className="size-1.5 rounded-full bg-success" /> Secret set
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setReplacingSecret(true)}>
                    Replace
                  </Button>
                </div>
              ) : (
                <Input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={config.has_secret ? "Enter a new secret" : "Paste the secret access key"}
                  className="font-mono text-[12.5px]"
                />
              )}
            </div>
          </div>

          <div className="flex justify-end border-t border-border/60 pt-4">
            <Button onClick={save} disabled={busy}>
              {busy ? <Spinner /> : <Save />} Save settings
            </Button>
          </div>
        </div>
      )}
    </Page>
  );
}
