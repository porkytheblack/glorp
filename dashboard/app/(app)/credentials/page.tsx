"use client";

import { Eye, Cpu, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@/lib/hooks";
import { api } from "@/lib/api";
import { compact, timeAgo } from "@/lib/format";
import { Page, PageHeader, Loading, EmptyState, ErrorState, ConfirmButton } from "@/components/shared";
import { SectionHeading } from "@/components/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AddProviderModal } from "./add-provider-modal";
import { AddProfileModal } from "./add-profile-modal";
import { EditProviderModal } from "./edit-provider-modal";
import { EditReasoningModal } from "./edit-reasoning-modal";
import type { Catalog, ProviderWire, ProfileWire } from "@/lib/types";

export default function CredentialsPage() {
  const providers = useQuery<{ providers: ProviderWire[] }>("/models/providers");
  const profiles = useQuery<{ profiles: ProfileWire[]; active_profile_id: string | null }>("/models/profiles");
  const catalog = useQuery<Catalog>("/models/catalog");

  const run = async (fn: () => Promise<unknown>, ok: string, reload: () => void) => {
    try {
      await fn();
      reload();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const provs = providers.data?.providers ?? [];
  const profs = profiles.data?.profiles ?? [];
  const activeId = profiles.data?.active_profile_id;

  return (
    <Page>
      <PageHeader title="Models" description="Model providers and the profiles sessions inherit by default. API keys are stored by the credential adapter and never returned." />

      <section className="mb-9">
        <SectionHeading eyebrow="Credentials" title="Providers" action={<AddProviderModal catalog={catalog.data} onSaved={providers.reload} />} />
        {providers.error && <ErrorState message={providers.error} className="mb-3" />}
        <div className="surface overflow-hidden">
          {providers.loading ? (
            <Loading />
          ) : provs.length === 0 ? (
            <EmptyState icon={Cpu} title="No providers configured" description="Add a provider to give sessions a model to run on." />
          ) : (
            <div className="divide-y divide-border/60">
              {provs.map((p) => (
                <div key={p.id} className="group flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate text-[13.5px] text-foreground">
                      <span className="truncate font-medium">{p.id}</span>
                      {p.based_on && <span className="text-[12px] font-normal text-faint">· based on {p.based_on}</span>}
                    </div>
                    <div className="truncate text-[11.5px] text-faint">
                      {p.adapter ? `${p.type} · ${p.adapter}` : p.type}
                      {p.base_url && <span className="ml-1.5 font-mono text-[12px]">{p.base_url}</span>}
                    </div>
                  </div>
                  {p.has_api_key ? (
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-[11.5px] font-medium text-success">
                      <span className="size-1.5 rounded-full bg-success" /> key set
                    </span>
                  ) : (
                    <span className="shrink-0 text-[11.5px] text-faint">no key</span>
                  )}
                  <div className="flex shrink-0 items-center gap-0.5">
                    <EditProviderModal provider={p} onSaved={providers.reload} />
                    <ConfirmButton label="" icon={Trash2} onConfirm={() => run(() => api(`/models/providers/${p.id}`, { method: "DELETE" }), "Provider removed", providers.reload)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <SectionHeading eyebrow="Defaults" title="Profiles" action={<AddProfileModal providers={provs} catalog={catalog.data} onSaved={profiles.reload} />} />
        <div className="surface overflow-hidden">
          {profiles.loading ? (
            <Loading />
          ) : profs.length === 0 ? (
            <EmptyState icon={Cpu} title="No profiles" description="A profile pairs a provider with a model (and optional reasoning effort)." />
          ) : (
            <div className="divide-y divide-border/60">
              {profs.map((p) => (
                <div key={p.id} className="group flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 truncate text-[13.5px] text-foreground">
                      <span className="truncate font-medium">{p.label}</span>
                      {p.id === activeId && <Badge variant="brand">Default</Badge>}
                    </div>
                    <div className="truncate font-mono text-[12px] text-faint">{p.provider_id} · {p.model}</div>
                  </div>
                  {p.reasoning_label && p.reasoning_label !== "off" && (
                    <Badge variant="outline" className="shrink-0">{p.reasoning_label}</Badge>
                  )}
                  {p.input_modalities?.includes("image") && (
                    <Eye className="hidden size-3.5 shrink-0 text-faint md:block" aria-label="vision-capable" />
                  )}
                  {p.context_limit != null && (
                    <span className="tnum hidden shrink-0 text-[12px] text-faint md:block">{compact(p.context_limit)} ctx</span>
                  )}
                  <span className="tnum hidden w-14 shrink-0 text-right text-[12px] text-faint sm:block">{timeAgo(p.last_used_at)}</span>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {p.id !== activeId && (
                      <Button variant="ghost" size="sm" onClick={() => run(() => api(`/models/profiles/${p.id}/activate`, { method: "POST" }), "Profile activated", profiles.reload)}>
                        Make default
                      </Button>
                    )}
                    <EditReasoningModal profile={p} onSaved={profiles.reload} />
                    <ConfirmButton label="" icon={Trash2} onConfirm={() => run(() => api(`/models/profiles/${p.id}`, { method: "DELETE" }), "Profile removed", profiles.reload)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </Page>
  );
}
