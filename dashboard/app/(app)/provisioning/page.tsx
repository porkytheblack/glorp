"use client";

import { useState } from "react";
import { Rocket, GitBranch, Terminal, Files } from "lucide-react";
import { useQuery } from "@/lib/hooks";
import { Page, PageHeader, Loading, EmptyState, ErrorState } from "@/components/shared";
import { plural } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ProvisionDialog } from "@/components/provisioning/provision-dialog";
import type { TemplateDto } from "@/lib/types";

export default function ProvisioningPage() {
  const { data, loading, error } = useQuery<{ templates: TemplateDto[] }>("/templates");
  const [launch, setLaunch] = useState<TemplateDto | null>(null);

  const templates = data?.templates ?? [];

  return (
    <Page>
      <PageHeader title="Provisioning" description="Reproducible setup recipes for a workspace." />

      <div className="mb-6 flex flex-col gap-3 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:gap-6">
        <p className="max-w-2xl text-[13px] text-muted-foreground">
          A <span className="text-foreground">template</span> is an ordered list of steps run in a fresh workspace before an agent starts — more
          than shell commands: it can clone a repo, run setup commands, and copy files, with <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[11px]">{"{param}"}</code> placeholders you fill in when provisioning.
        </p>
        <div className="flex shrink-0 gap-4 text-[12px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><GitBranch className="size-3.5" /> clone</span>
          <span className="flex items-center gap-1.5"><Terminal className="size-3.5" /> shell</span>
          <span className="flex items-center gap-1.5"><Files className="size-3.5" /> copy</span>
        </div>
      </div>

      {error && <ErrorState message={error} className="mb-4" />}

      {loading ? (
        <Loading />
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState
            icon={Rocket}
            title="No templates"
            description="Drop a JSON template (name, description, steps[]) into the Garage templates directory to provision workspaces here."
          />
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
                <Button size="sm" onClick={() => setLaunch(t)}>
                  Review &amp; provision
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ProvisionDialog template={launch} onClose={() => setLaunch(null)} />
    </Page>
  );
}
