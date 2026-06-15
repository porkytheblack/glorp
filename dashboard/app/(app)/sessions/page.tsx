"use client";

import { useRouter } from "next/navigation";
import { ChevronRight, MessageSquare, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@/lib/hooks";
import { api } from "@/lib/api";
import { Page, PageHeader, Loading, EmptyState, ErrorState, SessionStatus, ConfirmButton } from "@/components/shared";
import { timeAgo, compact, usd } from "@/lib/format";
import { NewSessionDialog } from "@/components/session/new-session-dialog";
import type { SessionDto, WorkspaceDto, ProfileDto } from "@/lib/types";

const RANK: Record<string, number> = { busy: 0, provisioning: 1, error: 2, idle: 3, destroyed: 4 };
const rank = (s: SessionDto) => RANK[s.state] ?? 3;

/** One session in the registry: status, title + model, token/turn columns, activity. */
function SessionRow({ s, onOpen, onDelete }: { s: SessionDto; onOpen: () => void; onDelete: () => void }) {
  const tokens = (s.tokens_in ?? 0) + (s.tokens_out ?? 0);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      className="group flex cursor-pointer items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-2"
    >
      <SessionStatus state={s.state} className="w-[104px] shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] text-foreground">{s.title ?? "Untitled session"}</div>
        <div className="truncate text-[11.5px] text-faint">{s.model_label ?? "Default model"}</div>
      </div>
      <span className="tnum hidden w-16 shrink-0 text-right text-[12px] text-brand sm:block" title="estimated cost (catalog list price)">{usd(s.cost_usd, s.cost_known)}</span>
      <span className="tnum hidden w-16 shrink-0 text-right text-[12px] text-muted-foreground sm:block">{compact(tokens)} tok</span>
      <span className="tnum hidden w-12 shrink-0 text-right text-[12px] text-faint md:block">{s.turn_count} {s.turn_count === 1 ? "turn" : "turns"}</span>
      <span className="tnum w-12 shrink-0 text-right text-[12px] text-faint">{timeAgo(s.last_activity)}</span>
      <span onClick={(e) => e.stopPropagation()} className="shrink-0">
        <ConfirmButton label="" icon={Trash2} onConfirm={onDelete} />
      </span>
      <ChevronRight className="size-4 shrink-0 text-faint/60 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
    </div>
  );
}

export default function SessionsPage() {
  const router = useRouter();
  const { data, loading, error, reload } = useQuery<{ sessions: SessionDto[]; total: number }>("/sessions", [], 4000);
  const workspaces = useQuery<{ workspaces: WorkspaceDto[] }>("/workspaces");
  const profiles = useQuery<{ profiles: ProfileDto[] }>("/models/profiles");

  const destroy = async (id: string) => {
    try {
      await api(`/sessions/${id}`, { method: "DELETE" });
      toast.success("Session destroyed");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const sessions = [...(data?.sessions ?? [])].sort(
    (a, b) => rank(a) - rank(b) || b.last_activity.localeCompare(a.last_activity),
  );

  return (
    <Page>
      <PageHeader
        title="Sessions"
        description="Every agent session in this namespace — live, idle, or rehydratable from disk."
        actions={<NewSessionDialog workspaces={workspaces.data?.workspaces ?? []} profiles={profiles.data?.profiles ?? []} />}
      />

      {error && <ErrorState message={error} className="mb-4" />}

      <div className="surface overflow-hidden">
        {loading ? (
          <Loading />
        ) : sessions.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No sessions yet" description="Launch one to put an agent to work — it runs in a sandboxed workspace." />
        ) : (
          <div className="divide-y divide-border/60">
            {sessions.map((s) => (
              <SessionRow key={s.id} s={s} onOpen={() => router.push(`/sessions/${s.id}`)} onDelete={() => destroy(s.id)} />
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}
