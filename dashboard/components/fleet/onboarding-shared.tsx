"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = ["Connect a provider", "Pick a model", "Put the agent to work"] as const;

/** Quiet 1 · 2 · 3 rail: done steps get a check, the current step the brand accent. */
export function StepRail({ step }: { step: number }) {
  return (
    <ol className="mb-9 flex items-center justify-center gap-2.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
      {STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <li key={label} className="flex items-center gap-2.5">
            <span
              className={cn(
                "grid size-5 place-items-center rounded-full border text-[11px] font-semibold tabular-nums transition-colors",
                done && "border-brand/40 bg-brand/15 text-brand",
                active && "border-brand bg-brand text-brand-foreground shadow-sheen",
                !done && !active && "border-border bg-surface-2 text-faint",
              )}
            >
              {done ? <Check className="size-3" /> : i + 1}
            </span>
            <span className={cn("hidden text-[12px] font-medium sm:block", active ? "text-foreground" : "text-faint")}>{label}</span>
            {i < STEPS.length - 1 && <span className="h-px w-5 bg-border sm:w-7" />}
          </li>
        );
      })}
    </ol>
  );
}

/** The framed body each step lives in: title, subtitle, then its controls. */
export function StepCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="surface animate-slide-up p-6 md:p-7">
      <h2 className="text-[16px] font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{subtitle}</p>
      <div className="mt-6 space-y-4">{children}</div>
    </div>
  );
}

/** A shimmering line of placeholder copy, e.g. while a key is being checked. */
export function ShimmerLine({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface-2/40 px-3.5 py-3">
      <div className="skeleton size-3.5 rounded-full" />
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
    </div>
  );
}

/** A success line in the success tone — used after key verification + at handoff. */
export function VerifiedLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-success/25 bg-success/[0.07] px-3.5 py-2.5 text-[12.5px] font-medium text-success">
      <Check className="size-3.5 shrink-0" />
      {children}
    </div>
  );
}
