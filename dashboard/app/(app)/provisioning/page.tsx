"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useToasts } from "@/lib/hooks";
import { api } from "@/lib/api";
import { PageHeader, Loading, EmptyState, ErrorNote, Modal, Field, Toasts } from "@/components/ui";
import type { TemplateDto, SessionDto } from "@/lib/types";

export default function ProvisioningPage() {
  const router = useRouter();
  const { data, loading, error } = useQuery<{ templates: TemplateDto[] }>("/templates");
  const { toasts, push } = useToasts();
  const [launch, setLaunch] = useState<TemplateDto | null>(null);
  const [params, setParams] = useState("");
  const [busy, setBusy] = useState(false);

  const provision = async () => {
    if (!launch) return;
    setBusy(true);
    try {
      let parsed: Record<string, string> = {};
      if (params.trim()) parsed = JSON.parse(params);
      const s = await api<SessionDto>("/sessions", { method: "POST", body: { template: launch.name, params: parsed } });
      push("Provisioning session created", "success");
      router.push(`/sessions/${s.id}`);
    } catch (e) {
      push(e instanceof Error ? e.message : "Provision failed", "error");
      setBusy(false);
    }
  };

  const templates = data?.templates ?? [];

  return (
    <div>
      <PageHeader title="Provisioning" subtitle="Declarative setup templates — clone a repo, run init scripts, then hand the prepared workspace to a fresh session." />
      {error && <ErrorNote message={error} />}
      {loading ? (
        <Loading />
      ) : templates.length === 0 ? (
        <EmptyState icon="⚙" title="No templates" hint="Add JSON templates under the Garage templates dir to provision workspaces here." />
      ) : (
        <div className="grid cols-3">
          {templates.map((t) => (
            <div className="card" key={t.name}>
              <strong>{t.name}</strong>
              <p className="muted" style={{ minHeight: 38, marginTop: 6 }}>{t.description ?? "No description."}</p>
              <div className="row spread">
                <span className="faint" style={{ fontSize: 12 }}>{(t.steps?.length ?? 0)} step(s)</span>
                <button className="btn sm primary" onClick={() => { setLaunch(t); setParams(""); }}>Provision →</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {launch && (
        <Modal
          title={`Provision from “${launch.name}”`}
          subtitle="Optionally pass template params as JSON (e.g. for repo URLs)."
          submitLabel="Provision"
          onClose={() => setLaunch(null)}
          onSubmit={provision}
          busy={busy}
        >
          <Field label="Params (JSON)">
            <textarea className="textarea" placeholder='{ "repo": "github.com/me/app" }' value={params} onChange={(e) => setParams(e.target.value)} />
          </Field>
        </Modal>
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}
