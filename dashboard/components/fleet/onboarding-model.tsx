"use client";

import * as React from "react";
import { ArrowLeft, Check, Cpu } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { verifyProvider, type VerifyOutcome } from "@/lib/verify-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState, Spinner } from "@/components/shared";
import { StepCard, ShimmerLine, VerifiedLine } from "./onboarding-shared";

/** Step 2 — verify the saved key, then pick a model from the live list it returns. */
export function PickModel({ providerId, catalog, onBack, onPicked }: { providerId: string; catalog: string[]; onBack: () => void; onPicked: (model: string) => void }) {
  const [outcome, setOutcome] = React.useState<VerifyOutcome | null>(null);
  const [model, setModel] = React.useState("");
  const [manual, setManual] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    setOutcome(null);
    verifyProvider(providerId).then((o) => live && setOutcome(o));
    return () => {
      live = false;
    };
  }, [providerId]);

  const models = outcome?.ok ? outcome.models : [];
  const escapeHatch = manual || (outcome && !outcome.ok);

  const pick = async (chosen: string) => {
    if (!chosen.trim() || busy) return;
    setBusy(true);
    try {
      await api("/models/profiles", { method: "POST", body: { providerId, model: chosen.trim(), activate: true } });
      onPicked(chosen.trim());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the model");
      setBusy(false);
    }
  };

  return (
    <StepCard title="Pick a model" subtitle="We verified the key against the provider — choose the model your agent should run on.">
      {!outcome && <ShimmerLine label="Checking the key against the provider…" />}

      {outcome?.ok && (
        <>
          <VerifiedLine>Key verified — {models.length} {models.length === 1 ? "model" : "models"} available</VerifiedLine>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border bg-surface-2/30 p-1.5">
            {models.length === 0 && <p className="px-2 py-3 text-[12.5px] text-muted-foreground">No models reported. Type one below.</p>}
            {models.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModel(m)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left font-mono text-[12.5px] transition-colors",
                  model === m ? "bg-brand/15 text-foreground" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                )}
              >
                <Check className={cn("size-3.5 shrink-0 text-brand transition-opacity", model === m ? "opacity-100" : "opacity-0")} />
                <span className="truncate">{m}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {outcome && !outcome.ok && (
        <ErrorState message={outcome.reason === "network" ? `${outcome.message} You can go back and fix the base URL.` : outcome.message} />
      )}

      {escapeHatch && (
        <div className="space-y-1.5">
          <span className="text-[13px] font-medium text-foreground">Model id</span>
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. gpt-4o" className="font-mono text-[12.5px]" />
          {catalog.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {catalog.slice(0, 6).map((m) => (
                <button key={m} type="button" onClick={() => setModel(m)} className="rounded-md border border-border bg-surface-2/40 px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground">
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={busy}>
          <ArrowLeft /> Back
        </Button>
        <div className="flex items-center gap-2">
          {outcome?.ok && !manual && (
            <button type="button" onClick={() => setManual(true)} className="text-[12px] text-faint transition-colors hover:text-muted-foreground">
              Continue anyway
            </button>
          )}
          <Button onClick={() => pick(model)} disabled={!model.trim() || busy}>
            {busy ? <Spinner /> : <Cpu />} Use model
          </Button>
        </div>
      </div>
    </StepCard>
  );
}
