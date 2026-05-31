/**
 * Presentational rows for the Models section: a configured-provider row (id +
 * has_api_key + Delete) and a profile row (active marked with CircleCheck +
 * "Default", plus Activate/Delete). Split out of Configuration.tsx to keep each
 * file small; all actions are bubbled up via callbacks.
 */

import { Trash2, CircleCheck, Loader2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import type { ProfileSummary, ProviderSummary } from "../../../api/client.ts";

export function ProviderRow(p: {
  provider: ProviderSummary;
  pending: boolean;
  onDelete: (id: string) => void;
}) {
  const pv = p.provider;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-glorp-border bg-glorp-surface/40 px-3.5 py-3">
      <KeyRound size={16} className={`shrink-0 ${pv.has_api_key ? "text-glorp-success" : "text-glorp-muted"}`} strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <span className="truncate text-[13px] font-medium text-glorp-text">{pv.id}</span>
        <div className="mt-0.5 text-[11px] text-glorp-muted">
          {pv.type} · {pv.has_api_key ? "API key set" : "no API key"}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={p.pending}
        onClick={() => p.onDelete(pv.id)}
        className="shrink-0 text-[12px] text-glorp-muted hover:text-glorp-error"
      >
        {p.pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
        Delete
      </Button>
    </div>
  );
}

export function ProfileRow(p: {
  profile: ProfileSummary;
  isActive: boolean;
  meta: string;
  activating: boolean;
  deleting: boolean;
  onActivate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const pr = p.profile;
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-3.5 py-3 ${
        p.isActive ? "border-glorp-border-active bg-glorp-surface-2" : "border-glorp-border bg-glorp-surface/40"
      }`}
    >
      <CircleCheck size={18} strokeWidth={1.75} className={`shrink-0 ${p.isActive ? "text-glorp-success" : "text-glorp-border"}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-glorp-text">{pr.label}</span>
          {p.isActive && (
            <span className="rounded bg-glorp-surface px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-glorp-success">
              Default
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-glorp-muted">
          <span className="truncate font-mono">{pr.model}</span>
          <span>·</span>
          <span>{pr.provider_id}</span>
          <span>·</span>
          <span>{p.meta}</span>
        </div>
      </div>
      {!p.isActive && (
        <Button
          variant="outline"
          size="sm"
          disabled={p.activating}
          onClick={() => p.onActivate(pr.id)}
          className="shrink-0 text-[12px]"
        >
          {p.activating && <Loader2 className="animate-spin" />}
          {p.activating ? "Activating…" : "Activate"}
        </Button>
      )}
      <Button
        variant="outline"
        size="icon"
        disabled={p.deleting}
        onClick={() => p.onDelete(pr.id)}
        aria-label="Delete profile"
        className="shrink-0 text-glorp-muted hover:text-glorp-error"
      >
        {p.deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
      </Button>
    </div>
  );
}
