"use client";

import { useRouter } from "next/navigation";
import { Boxes, Cpu, FolderGit2, MessageSquare, CircleDollarSign } from "lucide-react";
import { useQuery } from "@/lib/hooks";
import { compact, usd } from "@/lib/format";
import { Page, PageHeader, Loading, EmptyState, ErrorState } from "@/components/shared";
import { Metric, SectionHeading } from "@/components/primitives";
import type { NamespaceUsageDto, ModelUsageDto, UsageTotalsDto } from "@/lib/types";

/** Tokens "in · out" sublabel shared by every usage row. */
function Tokens({ t }: { t: UsageTotalsDto }) {
  return (
    <span className="truncate text-[11px] text-faint">
      {compact(t.tokens_in)} in · {compact(t.tokens_out)} out
    </span>
  );
}

/** Trailing cost cell, tinted brand, flagged when it's a floor estimate. */
function Cost({ t }: { t: UsageTotalsDto }) {
  return (
    <span className="tnum shrink-0 text-right text-[12.5px] text-brand" title={t.cost_known ? "catalog list price" : "no catalog price — token count only"}>
      {usd(t.cost_usd, t.cost_known)}
    </span>
  );
}

function ModelRow({ m }: { m: ModelUsageDto }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <Cpu className="size-4 shrink-0 text-faint" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-foreground">{m.label ?? m.model}</div>
        <div className="truncate text-[11px] text-faint">
          {m.provider_id} · {m.requests} {m.requests === 1 ? "call" : "calls"}
        </div>
      </div>
      <span className="tnum hidden w-32 shrink-0 text-right sm:block"><Tokens t={{ ...m }} /></span>
      <Cost t={{ ...m }} />
    </div>
  );
}

export default function UsagePage() {
  const router = useRouter();
  const { data, loading, error } = useQuery<NamespaceUsageDto>("/usage", [], 8000);

  const totals = data?.totals;
  const byModel = data?.by_model ?? [];
  const byWorkspace = data?.by_workspace ?? [];
  const bySession = data?.by_session ?? [];
  const ready = !loading || !!data;
  const v = <T,>(x: T) => (ready ? x : "—");

  return (
    <Page>
      <PageHeader
        title="Usage & cost"
        description="Cumulative tokens and estimated spend across this namespace — by model, workspace, and session. Costs use models.dev catalog list prices; models without a catalog price show tokens only (~)."
      />

      {error && <ErrorState message={error} className="mb-4" />}

      <div className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Total spend" value={totals ? usd(totals.cost_usd, totals.cost_known) : v("—")} icon={CircleDollarSign} tone="brand" hint="estimated, all sessions" />
        <Metric label="Tokens in" value={totals ? compact(totals.tokens_in) : v("—")} icon={MessageSquare} hint="cumulative" />
        <Metric label="Tokens out" value={totals ? compact(totals.tokens_out) : v("—")} icon={MessageSquare} hint="cumulative" />
        <Metric label="Models" value={v(byModel.length)} icon={Cpu} hint="used across the chain" />
      </div>

      {loading && !data ? (
        <Loading />
      ) : !totals || (byModel.length === 0 && bySession.length === 0) ? (
        <EmptyState icon={CircleDollarSign} title="No usage yet" description="Run a session and token spend will accrue here, broken down by model, workspace, and session." />
      ) : (
        <div className="space-y-8">
          <section>
            <SectionHeading eyebrow="By model" title="Models used" />
            <div className="surface divide-y divide-border/60 overflow-hidden">
              {byModel.map((m) => (
                <ModelRow key={`${m.provider_id}/${m.model}`} m={m} />
              ))}
            </div>
          </section>

          {byWorkspace.length > 0 && (
            <section>
              <SectionHeading eyebrow="By workspace" title="Workspaces" />
              <div className="surface divide-y divide-border/60 overflow-hidden">
                {byWorkspace.map((w) => (
                  <div key={w.workspace_id ?? "none"} className="flex items-center gap-3 px-3.5 py-2.5">
                    <FolderGit2 className="size-4 shrink-0 text-faint" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-foreground">{w.name}</div>
                      <Tokens t={w.totals} />
                    </div>
                    <Cost t={w.totals} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {bySession.length > 0 && (
            <section>
              <SectionHeading eyebrow="By session" title="Sessions" />
              <div className="surface divide-y divide-border/60 overflow-hidden">
                {bySession.map((s) => (
                  <div
                    key={s.session_id}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/sessions/${s.session_id}`)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), router.push(`/sessions/${s.session_id}`))}
                    className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-2"
                  >
                    <Boxes className="size-4 shrink-0 text-faint" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-foreground">{s.title ?? "Untitled session"}</div>
                      <div className="truncate text-[11px] text-faint">{s.model_label ?? "—"} · {compact(s.totals.tokens_in + s.totals.tokens_out)} tok</div>
                    </div>
                    <Cost t={s.totals} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Page>
  );
}
