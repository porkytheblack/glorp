"use client";

import { useState } from "react";
import { ChevronRight, Rocket, GitBranch, Terminal, Files } from "lucide-react";
import { useQuery } from "@/lib/hooks";
import { Page, PageHeader, Loading, EmptyState, ErrorState } from "@/components/shared";
import { SectionHeading } from "@/components/primitives";
import { plural } from "@/lib/format";
import { ProvisionDialog } from "@/components/provisioning/provision-dialog";
import type { TemplateSummaryDto } from "@/lib/types";

/** One template, dense but legible — click anywhere to review & provision. */
function TemplateRow({ t, onLaunch }: { t: TemplateSummaryDto; onLaunch: () => void }) {
  return (
    <button
      type="button"
      onClick={onLaunch}
      className="group flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-surface-2"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-faint shadow-sheen transition-colors group-hover:text-brand">
        <Rocket className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium text-foreground">{t.name}</div>
        <div className="truncate text-[12px] text-muted-foreground">{t.description ?? "No description."}</div>
      </div>
      <span className="tnum hidden w-14 shrink-0 text-right text-[12px] text-faint sm:block">{plural(t.step_count ?? 0, "step")}</span>
      <ChevronRight className="size-4 shrink-0 text-faint/60 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
    </button>
  );
}

export default function ProvisioningPage() {
  const { data, loading, error } = useQuery<{ templates: TemplateSummaryDto[] }>("/templates");
  const [launch, setLaunch] = useState<TemplateSummaryDto | null>(null);

  const templates = data?.templates ?? [];

  return (
    <Page>
      <PageHeader title="Provisioning" description="Reproducible setup recipes that prepare a fresh workspace before an agent starts." />

      <div className="surface mb-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-6">
        <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          A <span className="text-foreground">template</span> is an ordered list of steps — it can clone a repo, run setup commands, and copy files, with{" "}
          <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px]">{"{param}"}</code> placeholders you fill in when provisioning.
        </p>
        <div className="flex shrink-0 gap-4 text-[12px] text-faint">
          <span className="flex items-center gap-1.5"><GitBranch className="size-3.5" /> clone</span>
          <span className="flex items-center gap-1.5"><Terminal className="size-3.5" /> shell</span>
          <span className="flex items-center gap-1.5"><Files className="size-3.5" /> copy</span>
        </div>
      </div>

      {error && <ErrorState message={error} className="mb-4" />}

      <SectionHeading eyebrow="Library" title="Templates" />

      {loading ? (
        <div className="surface">
          <Loading />
        </div>
      ) : templates.length === 0 ? (
        <div className="surface">
          <EmptyState
            icon={Rocket}
            title="No templates"
            description="Drop a JSON template (name, description, steps[]) into the Garage templates directory to provision workspaces here."
          />
        </div>
      ) : (
        <div className="surface overflow-hidden">
          <div className="divide-y divide-border/60">
            {templates.map((t) => (
              <TemplateRow key={t.name} t={t} onLaunch={() => setLaunch(t)} />
            ))}
          </div>
        </div>
      )}

      <ProvisionDialog template={launch} onClose={() => setLaunch(null)} />
    </Page>
  );
}
