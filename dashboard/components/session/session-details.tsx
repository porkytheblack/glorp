"use client";

import { cn } from "@/lib/utils";
import { compact, timeAgo } from "@/lib/format";
import { CopyButton } from "@/components/shared";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { SessionDto, SessionStats } from "@/lib/types";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-[13px] text-foreground">{children}</span>
    </div>
  );
}

const MODE_LABEL: Record<string, string> = {
  normal: "Normal — prompt for risky tools",
  auto: "Auto — auto-approve",
  bypass: "Bypass — no prompts",
};

/** The Details tab: workspace, model, permission mode, usage, and ids. */
export function SessionDetails({
  session,
  stats,
  mode,
  onMode,
}: {
  session: SessionDto;
  stats: SessionStats | null;
  mode: string;
  onMode: (mode: string) => void;
}) {
  const tokens = stats ? `${compact(stats.tokens_in)} in · ${compact(stats.tokens_out)} out` : "—";
  const ctx = stats ? `${Math.round(stats.contextPct)}%` : "—";

  return (
    <div className="grid max-w-2xl gap-4">
      <div className="rounded-lg border border-border bg-card px-5 py-2">
        <Row label="Workspace">
          <span className="font-mono text-[12.5px] text-muted-foreground">{session.workspace}</span>
        </Row>
        <div className="border-t border-border/60" />
        <Row label="Model">{session.model_label ?? "Default"}</Row>
        <div className="border-t border-border/60" />
        <Row label="Permission mode">
          <Select value={mode} onValueChange={onMode}>
            <SelectTrigger className="h-8 w-[260px] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(MODE_LABEL).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </div>

      <div className="rounded-lg border border-border bg-card px-5 py-2">
        <Row label="Turns">{stats ? stats.turns : session.turn_count}</Row>
        <div className="border-t border-border/60" />
        <Row label="Tokens">{tokens}</Row>
        <div className="border-t border-border/60" />
        <Row label="Context used">
          <span className={cn(stats && stats.contextPct > 80 ? "text-warning" : undefined)}>{ctx}</span>
        </Row>
        <div className="border-t border-border/60" />
        <Row label="Last activity">{timeAgo(session.last_activity)}</Row>
        {session.custom_credentials && (
          <>
            <div className="border-t border-border/60" />
            <Row label="Credentials">
              <span className="font-mono text-[12.5px]">
                {session.custom_credentials.provider} ····{session.custom_credentials.last4}
              </span>
            </Row>
          </>
        )}
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border bg-card px-5 py-3">
        <div className="min-w-0">
          <div className="text-[12px] text-muted-foreground">Session ID</div>
          <code className="block truncate font-mono text-[12.5px] text-foreground/80">{session.id}</code>
        </div>
        <CopyButton value={session.id} />
      </div>
    </div>
  );
}
