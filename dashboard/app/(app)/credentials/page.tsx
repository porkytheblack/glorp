"use client";

import { Cpu, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@/lib/hooks";
import { api } from "@/lib/api";
import { Page, PageHeader, Loading, EmptyState, ErrorState, ConfirmButton } from "@/components/shared";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AddProviderModal } from "./add-provider-modal";
import { AddProfileModal } from "./add-profile-modal";
import type { Catalog, ProviderWire, ProfileWire } from "@/lib/types";

function SectionHead({ title, action }: { title: string; action: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      {action}
    </div>
  );
}

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

      <section className="mb-8">
        <SectionHead title="Providers" action={<AddProviderModal catalog={catalog.data} onSaved={providers.reload} />} />
        {providers.error && <ErrorState message={providers.error} className="mb-3" />}
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {providers.loading ? (
            <Loading />
          ) : provs.length === 0 ? (
            <EmptyState icon={Cpu} title="No providers configured" description="Add a provider to give sessions a model to run on." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Provider</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="hidden md:table-cell">Base URL</TableHead>
                  <TableHead>API key</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {provs.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium text-foreground">
                      {p.id}
                      {p.based_on && <span className="ml-1.5 text-[12px] font-normal text-muted-foreground">· based on {p.based_on}</span>}
                    </TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">{p.adapter ? `${p.type} (${p.adapter})` : p.type}</TableCell>
                    <TableCell className="hidden font-mono text-[12.5px] text-muted-foreground md:table-cell">{p.base_url ?? "—"}</TableCell>
                    <TableCell>{p.has_api_key ? <Badge variant="success">set</Badge> : <Badge variant="outline">none</Badge>}</TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <ConfirmButton label="" icon={Trash2} onConfirm={() => run(() => api(`/models/providers/${p.id}`, { method: "DELETE" }), "Provider removed", providers.reload)} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      <section>
        <SectionHead title="Model profiles" action={<AddProfileModal providers={provs} catalog={catalog.data} onSaved={profiles.reload} />} />
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {profiles.loading ? (
            <Loading />
          ) : profs.length === 0 ? (
            <EmptyState icon={Cpu} title="No profiles" description="A profile pairs a provider with a model (and optional reasoning effort)." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Label</TableHead>
                  <TableHead className="hidden sm:table-cell">Provider</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="w-44" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {profs.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium text-foreground">
                      {p.label}
                      {p.id === activeId && (
                        <Badge variant="brand" className="ml-2">
                          active
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-[13px] text-muted-foreground sm:table-cell">{p.provider_id}</TableCell>
                    <TableCell className="font-mono text-[12.5px] text-muted-foreground">{p.model}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {p.id !== activeId && (
                          <Button variant="ghost" size="sm" onClick={() => run(() => api(`/models/profiles/${p.id}/activate`, { method: "POST" }), "Profile activated", profiles.reload)}>
                            Activate
                          </Button>
                        )}
                        <ConfirmButton label="" icon={Trash2} onConfirm={() => run(() => api(`/models/profiles/${p.id}`, { method: "DELETE" }), "Profile removed", profiles.reload)} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>
    </Page>
  );
}
