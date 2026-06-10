"use client";

import { Activity, CircleDashed, FolderGit2, Gauge } from "lucide-react";
import { useQuery } from "@/lib/hooks";
import { compact } from "@/lib/format";
import { ErrorState } from "@/components/shared";
import { Metric } from "@/components/primitives";
import { LaunchComposer } from "@/components/fleet/launch";
import { ActiveSessions } from "@/components/fleet/lanes";
import type { SessionDto, WorkspaceDto, ProfileDto } from "@/lib/types";

export default function FleetPage() {
  // The fleet is live: poll sessions so running/idle counts and lanes stay fresh.
  const sessions = useQuery<{ sessions: SessionDto[]; total: number }>("/sessions", [], 4000);
  const workspaces = useQuery<{ workspaces: WorkspaceDto[] }>("/workspaces");
  const profiles = useQuery<{ profiles: ProfileDto[] }>("/models/profiles");

  const all = sessions.data?.sessions ?? [];
  const live = all.filter((s) => s.state !== "destroyed");
  const running = live.filter((s) => s.state === "busy" || s.state === "provisioning").length;
  const idle = live.filter((s) => s.state === "idle").length;
  const wsCount = workspaces.data?.workspaces?.length ?? 0;
  const tokensOut = live.reduce((n, s) => n + (s.tokens_out ?? 0), 0);
  const ready = !sessions.loading || all.length > 0;
  const v = (n: number) => (ready ? n : "—");

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1080px] animate-fade-in px-6 py-10 md:px-9 md:py-12">
        <div className="mx-auto max-w-2xl">
          <LaunchComposer workspaces={workspaces.data?.workspaces ?? []} profiles={profiles.data?.profiles ?? []} />
        </div>

        <div className="mt-11 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Running" value={v(running)} icon={Activity} tone="success" hint="busy or provisioning" />
          <Metric label="Idle" value={v(idle)} icon={CircleDashed} hint="loaded, awaiting work" />
          <Metric label="Workspaces" value={ready ? wsCount : "—"} icon={FolderGit2} hint="in this namespace" />
          <Metric label="Tokens out" value={ready ? compact(tokensOut) : "—"} icon={Gauge} tone="brand" hint="across live sessions" />
        </div>

        {sessions.error && <ErrorState message={sessions.error} className="mt-8" />}

        <ActiveSessions sessions={live} className="mt-9" />
      </div>
    </div>
  );
}
