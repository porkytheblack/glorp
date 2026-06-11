"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, FolderGit2, Rocket, Terminal, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/hooks";
import { stepSummary } from "@/lib/template";
import { Loading, Spinner } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { TemplateSummaryDto, TemplateParamDto, TemplateFull, TemplateStep, SessionDto } from "@/lib/types";

const STEP_ICON: Record<TemplateStep["type"], LucideIcon> = { "git-clone": FolderGit2, shell: Terminal, copy: Copy };

/** Seed the form with each declared param's default (blank when none). */
function defaultsFor(params: TemplateParamDto[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of params) out[p.name] = p.default ?? "";
  return out;
}

/** One declared-param input: required marking, default prefilled, secret → password. */
function ParamField({ param, value, onChange }: { param: TemplateParamDto; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 font-mono">
        {param.name}
        {param.required && <span className="text-destructive" aria-hidden>*</span>}
        {param.secret && <span className="rounded bg-surface-2 px-1 py-0.5 text-[10px] font-normal text-faint">secret</span>}
      </Label>
      {param.description && <p className="text-[12px] text-muted-foreground">{param.description}</p>}
      <Input
        type={param.secret ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={param.default ? `default: ${param.default}` : `value for ${param.name}`}
      />
    </div>
  );
}

export function ProvisionDialog({ template, onClose }: { template: TemplateSummaryDto | null; onClose: () => void }) {
  const router = useRouter();
  const { data, loading } = useQuery<{ template: TemplateFull }>(template ? `/templates/${template.name}` : null, [template?.name]);
  const [params, setParams] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  const decls = template?.params ?? [];
  const steps = data?.template.steps ?? [];

  // Reset to the template's declared defaults whenever the open template changes.
  React.useEffect(() => {
    setParams(defaultsFor(template?.params ?? []));
  }, [template?.name]);

  // Required params with no value block provisioning; optional ones never do.
  const incomplete = decls.some((p) => p.required && !(params[p.name] ?? "").trim());

  const provision = async () => {
    if (!template) return;
    setBusy(true);
    try {
      // Drop blank optional values so the server applies the template's defaults.
      const filled = Object.fromEntries(Object.entries(params).filter(([, v]) => v.trim() !== ""));
      const s = await api<SessionDto>("/sessions", { method: "POST", body: { template: template.name, params: filled } });
      toast.success("Provisioning session created");
      router.push(`/sessions/${s.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Provision failed");
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Provision “{template?.name}”</DialogTitle>
          <DialogDescription>This template prepares a fresh workspace, then it’s handed to a new session.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <Loading />
        ) : (
          <div className="space-y-5">
            {steps.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">Steps</p>
                <ol className="overflow-hidden rounded-lg border border-border bg-surface-2/40 divide-y divide-border/60">
                  {steps.map((step, i) => {
                    const Icon = STEP_ICON[step.type];
                    return (
                      <li key={i} className="flex items-start gap-2.5 px-3 py-2">
                        <span className="tnum mt-0.5 w-4 shrink-0 text-center text-[12px] text-faint">{i + 1}</span>
                        <Icon className="mt-0.5 size-3.5 shrink-0 text-faint" />
                        <span className="min-w-0 break-words font-mono text-[12.5px] text-foreground/85">{stepSummary(step)}</span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

            {decls.length > 0 && (
              <div className="space-y-4 border-t border-border pt-4">
                <p className="text-[12px] text-muted-foreground">Fill in this template’s parameters:</p>
                {decls.map((p) => (
                  <ParamField key={p.name} param={p} value={params[p.name] ?? ""} onChange={(v) => setParams((cur) => ({ ...cur, [p.name]: v }))} />
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={provision} disabled={busy || loading || incomplete}>
            {busy ? <Spinner /> : <Rocket />} Provision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
