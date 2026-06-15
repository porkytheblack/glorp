"use client";

import * as React from "react";
import { Activity, CircleDashed, FolderGit2, CircleDollarSign } from "lucide-react";
import { useQuery } from "@/lib/hooks";
import { compact, usd } from "@/lib/format";
import { ErrorState } from "@/components/shared";
import { Metric } from "@/components/primitives";
import { LaunchComposer } from "@/components/fleet/launch";
import { ActiveSessions } from "@/components/fleet/lanes";
import { OnboardingFlow } from "@/components/fleet/onboarding";
import type { SessionDto, WorkspaceDto, ProfileDto } from "@/lib/types";

const SKIP_KEY = "garage.onboarding.skipped";

export default function FleetPage() {
  // The fleet is live: poll sessions so running/idle counts and lanes stay fresh.
  const sessions = useQuery<{ sessions: SessionDto[]; total: number }>("/sessions", [], 4000);
  const workspaces = useQuery<{ workspaces: WorkspaceDto[] }>("/workspaces");
  const profiles = useQuery<{ profiles: ProfileDto[]; active_profile_id?: string | null }>("/models/profiles");

  const [skipped, setSkipped] = React.useState(false);
  React.useEffect(() => {
    setSkipped(sessionStorage.getItem(SKIP_KEY) === "1");
  }, []);

  const all = sessions.data?.sessions ?? [];
  const live = all.filter((s) => s.state !== "destroyed");
  const running = live.filter((s) => s.state === "busy" || s.state === "provisioning").length;
  const idle = live.filter((s) => s.state === "idle").length;
  const wsCount = workspaces.data?.workspaces?.length ?? 0;
  const tokensOut = live.reduce((n, s) => n + (s.tokens_out ?? 0), 0);
  const spend = live.reduce((n, s) => n + (s.cost_usd ?? 0), 0);
  const spendKnown = live.every((s) => s.cost_known !== false);
  const ready = !sessions.loading || all.length > 0;
  const v = (n: number) => (ready ? n : "—");

  // Zero-state: no model means the Fleet can't launch — guide setup instead.
  const profs = profiles.data?.profiles ?? [];
  const onboard = !profiles.loading && profs.length === 0 && !skipped;
  // Hide metrics until there's something to count.
  const showMetrics = live.length > 0 && running + idle + wsCount + tokensOut > 0;

  if (onboard) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-[1080px] animate-fade-in px-6 py-10 md:px-9 md:py-12">
          <OnboardingFlow
            workspaces={workspaces.data?.workspaces ?? []}
            profiles={profs}
            onDone={profiles.reload}
            onSkip={() => {
              sessionStorage.setItem(SKIP_KEY, "1");
              setSkipped(true);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1080px] animate-fade-in px-6 py-10 md:px-9 md:py-12">
        <div className="mx-auto max-w-2xl">
          <LaunchComposer
            workspaces={workspaces.data?.workspaces ?? []}
            profiles={profs}
            defaultModelLabel={profs.find((p) => p.id === profiles.data?.active_profile_id)?.label ?? null}
          />
        </div>

        {showMetrics && (
          <div className="mt-11 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Running" value={v(running)} icon={Activity} tone="success" hint="busy or provisioning" />
            <Metric label="Idle" value={v(idle)} icon={CircleDashed} hint="loaded, awaiting work" />
            <Metric label="Workspaces" value={ready ? wsCount : "—"} icon={FolderGit2} hint="in this namespace" />
            <Metric label="Spend" value={ready ? usd(spend, spendKnown) : "—"} icon={CircleDollarSign} tone="brand" hint={`est. · ${compact(tokensOut)} tokens out`} />
          </div>
        )}

        {sessions.error && <ErrorState message={sessions.error} className="mt-8" />}

        <ActiveSessions sessions={live} className="mt-9" />
      </div>
    </div>
  );
}
