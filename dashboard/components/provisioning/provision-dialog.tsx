"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, FolderGit2, Rocket, Terminal, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/hooks";
import { templateParams, stepSummary } from "@/lib/template";
import { Loading, Spinner } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { TemplateDto, TemplateFull, TemplateStep, SessionDto } from "@/lib/types";

const STEP_ICON: Record<TemplateStep["type"], LucideIcon> = { "git-clone": FolderGit2, shell: Terminal, copy: Copy };

export function ProvisionDialog({ template, onClose }: { template: TemplateDto | null; onClose: () => void }) {
  const router = useRouter();
  const { data, loading } = useQuery<{ template: TemplateFull }>(template ? `/templates/${template.name}` : null, [template?.name]);
  const [params, setParams] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  const steps = data?.template.steps ?? [];
  const names = React.useMemo(() => templateParams(steps), [steps]);

  React.useEffect(() => {
    setParams({});
  }, [template?.name]);

  const provision = async () => {
    if (!template) return;
    setBusy(true);
    try {
      const s = await api<SessionDto>("/sessions", { method: "POST", body: { template: template.name, params } });
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
          <DialogDescription>These steps run in a fresh workspace, then it’s handed to a new session.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <Loading />
        ) : (
          <div className="space-y-4">
            <ol className="space-y-1.5">
              {steps.map((step, i) => {
                const Icon = STEP_ICON[step.type];
                return (
                  <li key={i} className="flex items-start gap-2.5 rounded-md border border-border bg-card px-3 py-2">
                    <span className="mt-0.5 w-4 shrink-0 text-center text-[12px] text-muted-foreground">{i + 1}</span>
                    <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 break-words font-mono text-[12.5px] text-foreground/85">{stepSummary(step)}</span>
                  </li>
                );
              })}
            </ol>

            {names.length > 0 && (
              <div className="space-y-3 border-t border-border pt-3">
                <p className="text-[12px] text-muted-foreground">This template needs:</p>
                {names.map((n) => (
                  <div key={n} className="space-y-1.5">
                    <Label className="font-mono">{n}</Label>
                    <Input value={params[n] ?? ""} onChange={(e) => setParams((p) => ({ ...p, [n]: e.target.value }))} placeholder={`value for ${n}`} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={provision} disabled={busy || loading || names.some((n) => !params[n]?.trim())}>
            {busy ? <Spinner /> : <Rocket />} Provision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
