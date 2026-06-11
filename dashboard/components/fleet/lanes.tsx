"use client";

import Link from "next/link";
import { ChevronRight, FolderGit2, MessageSquare } from "lucide-react";
import { baseName, timeAgo, compact } from "@/lib/format";
import { SessionStatus, EmptyState } from "@/components/shared";
import { SectionHeading } from "@/components/primitives";
import { cn } from "@/lib/utils";
import type { SessionDto } from "@/lib/types";

const LANE_CAP = 6;
const RANK: Record<string, number> = { busy: 0, provisioning: 1, error: 2, idle: 3, destroyed: 4 };

function rank(s: SessionDto): number {
  return RANK[s.state] ?? 3;
}

/** A single agent session, dense but legible — the unit of the fleet. */
function SessionRow({ s }: { s: SessionDto }) {
  const tokens = (s.tokens_in ?? 0) + (s.tokens_out ?? 0);
  return (
    <Link
      href={`/sessions/${s.id}`}
      className="group flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-2"
    >
      <SessionStatus state={s.state} className="w-[104px] shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] text-foreground">{s.title ?? "Untitled session"}</div>
        <div className="truncate text-[11.5px] text-faint">{s.model_label ?? "Default model"}</div>
      </div>
      <span className="tnum hidden w-16 shrink-0 text-right text-[12px] text-muted-foreground sm:block">{compact(tokens)} tok</span>
      <span className="tnum hidden w-12 shrink-0 text-right text-[12px] text-faint md:block">{s.turn_count} {s.turn_count === 1 ? "turn" : "turns"}</span>
      <span className="tnum w-12 shrink-0 text-right text-[12px] text-faint">{timeAgo(s.last_activity)}</span>
      <ChevronRight className="size-4 shrink-0 text-faint/60 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
    </Link>
  );
}

/** One workspace's sessions, headed by the workspace name + a live count. */
function WorkspaceLane({ name, sessions }: { name: string; sessions: SessionDto[] }) {
  const running = sessions.filter((s) => s.state === "busy" || s.state === "provisioning").length;
  const shown = sessions.slice(0, LANE_CAP);
  const overflow = sessions.length - shown.length;
  return (
    <div className="surface overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border/70 bg-surface-2/40 px-3.5 py-2">
        <FolderGit2 className="size-3.5 text-faint" />
        <span className="text-[12.5px] font-medium text-foreground">{name}</span>
        {running > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-success">
            <span className="size-1.5 rounded-full bg-success" />
            {running} running
          </span>
        )}
        <span className="ml-auto text-[11.5px] text-faint">{sessions.length} {sessions.length === 1 ? "session" : "sessions"}</span>
      </div>
      <div className="divide-y divide-border/60">
        {shown.map((s) => (
          <SessionRow key={s.id} s={s} />
        ))}
      </div>
      {overflow > 0 && (
        <Link href="/sessions" className="block border-t border-border/60 px-3.5 py-2 text-[12px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground">
          +{overflow} more in {name} →
        </Link>
      )}
    </div>
  );
}

/** The fleet: active + idle sessions, grouped by workspace, busiest lane first. */
export function ActiveSessions({ sessions, className }: { sessions: SessionDto[]; className?: string }) {
  const live = sessions.filter((s) => s.state !== "destroyed");
  const lanes = new Map<string, SessionDto[]>();
  for (const s of live) {
    const key = baseName(s.workspace);
    (lanes.get(key) ?? lanes.set(key, []).get(key)!).push(s);
  }
  const ordered = [...lanes.entries()]
    .map(([name, list]) => ({ name, list: [...list].sort((a, b) => rank(a) - rank(b) || b.last_activity.localeCompare(a.last_activity)) }))
    .sort((a, b) => rank(a.list[0]) - rank(b.list[0]) || b.list[0].last_activity.localeCompare(a.list[0].last_activity));

  return (
    <section className={cn("animate-slide-up", className)}>
      <SectionHeading
        eyebrow="Fleet"
        title="Active sessions"
        action={
          <Link href="/sessions" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground">
            All sessions <ChevronRight className="size-3.5" />
          </Link>
        }
      />
      {ordered.length === 0 ? (
        <div className="surface">
          <EmptyState icon={MessageSquare} title="No sessions running" description="Launch a task above and it will appear here, grouped by the workspace it runs in." />
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {ordered.map((lane) => (
            <WorkspaceLane key={lane.name} name={lane.name} sessions={lane.list} />
          ))}
        </div>
      )}
    </section>
  );
}
