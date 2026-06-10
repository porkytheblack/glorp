"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, KeyRound, Gauge, WifiOff, ServerCrash, AlertTriangle, ArrowRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatTurn } from "@/lib/types";

type Kind = "config" | "auth" | "rate_limit" | "quota" | "network" | "upstream" | "internal";

const KIND: Record<Kind, { icon: LucideIcon; label: string }> = {
  config: { icon: KeyRound, label: "Setup" },
  auth: { icon: KeyRound, label: "Authentication" },
  rate_limit: { icon: Gauge, label: "Rate limit" },
  quota: { icon: Gauge, label: "Quota" },
  network: { icon: WifiOff, label: "Network" },
  upstream: { icon: ServerCrash, label: "Provider" },
  internal: { icon: AlertTriangle, label: "Agent" },
};

function resumesAt(retryAfterSec: number, createdAt: number): string {
  const t = new Date(createdAt + retryAfterSec * 1000);
  return t.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * A failed turn, rendered as something a person can act on: human headline,
 * one-line recovery hint, a direct action, and the raw error tucked into a
 * collapsed technical view — never a bare stack trace in the conversation.
 */
export function ErrorCard({ turn }: { turn: ChatTurn }) {
  const [showDetail, setShowDetail] = React.useState(false);
  const meta = (turn.meta ?? {}) as { kind?: Kind; hint?: string; retryAfterSec?: number; detail?: string };
  const kind: Kind = meta.kind && meta.kind in KIND ? meta.kind : "internal";
  const { icon: Icon, label } = KIND[kind];
  const needsKey = kind === "auth" || kind === "config";
  const needsModel = kind === "quota" || kind === "rate_limit";

  return (
    <div className="mx-auto w-full max-w-xl rounded-lg border border-destructive/25 bg-destructive/[0.06] px-4 py-3 shadow-sheen">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border border-destructive/25 bg-destructive/10 text-destructive">
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className="text-[13.5px] font-semibold text-foreground">{turn.text}</p>
            <span className="text-[10.5px] font-medium uppercase tracking-wider text-destructive/80">{label}</span>
          </div>
          {meta.hint && <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{meta.hint}</p>}
          {meta.retryAfterSec != null && (
            <p className="mt-1 text-[12px] text-faint">Provider window resets around {resumesAt(meta.retryAfterSec, turn.createdAt)}.</p>
          )}

          <div className="mt-2.5 flex items-center gap-3">
            {needsKey && (
              <Link
                href="/credentials"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-foreground shadow-sheen transition-colors hover:bg-elevated"
              >
                Open Models <ArrowRight className="size-3" />
              </Link>
            )}
            {needsModel && (
              <span className="text-[12px] text-muted-foreground">Switch models from the composer below to keep working.</span>
            )}
            {meta.detail && (
              <button
                type="button"
                onClick={() => setShowDetail((s) => !s)}
                className="inline-flex items-center gap-1 text-[12px] text-faint transition-colors hover:text-muted-foreground"
              >
                <ChevronRight className={cn("size-3 transition-transform", showDetail && "rotate-90")} />
                Technical details
              </button>
            )}
          </div>

          {showDetail && meta.detail && (
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-background p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {meta.detail}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
