"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Rocket } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@/lib/hooks";
import { api } from "@/lib/api";
import { Page, PageHeader, Loading, EmptyState, ErrorState, Spinner } from "@/components/shared";
import { plural } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { TemplateDto, SessionDto } from "@/lib/types";

export default function ProvisioningPage() {
  const router = useRouter();
  const { data, loading, error } = useQuery<{ templates: TemplateDto[] }>("/templates");
  const [launch, setLaunch] = useState<TemplateDto | null>(null);
  const [params, setParams] = useState("");
  const [busy, setBusy] = useState(false);

  const provision = async () => {
    if (!launch) return;
    setBusy(true);
    try {
      const parsed = params.trim() ? JSON.parse(params) : {};
      const s = await api<SessionDto>("/sessions", { method: "POST", body: { template: launch.name, params: parsed } });
      toast.success("Provisioning session created");
      router.push(`/sessions/${s.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Provision failed");
      setBusy(false);
    }
  };

  const templates = data?.templates ?? [];

  return (
    <Page>
      <PageHeader title="Provisioning" description="Declarative setup templates — clone a repo, run init scripts, then hand the prepared workspace to a fresh session." />

      {error && <ErrorState message={error} className="mb-4" />}

      {loading ? (
        <Loading />
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState icon={Rocket} title="No templates" description="Add JSON templates to the Garage templates directory to provision workspaces here." />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <div key={t.name} className="flex flex-col rounded-xl border border-border bg-card p-5">
              <div className="mb-1 flex items-center gap-2">
                <Rocket className="size-4 text-muted-foreground" />
                <h3 className="font-medium text-foreground">{t.name}</h3>
              </div>
              <p className="min-h-[40px] flex-1 text-[13px] text-muted-foreground">{t.description ?? "No description."}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[12px] text-muted-foreground">{plural(t.step_count ?? 0, "step")}</span>
                <Button size="sm" onClick={() => { setLaunch(t); setParams(""); }}>
                  Provision
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!launch} onOpenChange={(o) => !o && setLaunch(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Provision from “{launch?.name}”</DialogTitle>
            <DialogDescription>Optionally pass template params as JSON (e.g. a repo URL).</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Params (JSON)</Label>
            <Textarea value={params} onChange={(e) => setParams(e.target.value)} placeholder={'{ "repo": "github.com/me/app" }'} className="font-mono text-[12.5px]" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLaunch(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={provision} disabled={busy}>
              {busy ? <Spinner /> : <Rocket />} Provision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
