import * as React from "react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

type Tone = "neutral" | "brand" | "success" | "warning" | "destructive";

const TONE: Record<Tone, { value: string; icon: string }> = {
  neutral: { value: "text-foreground", icon: "text-faint" },
  brand: { value: "text-foreground", icon: "text-brand" },
  success: { value: "text-foreground", icon: "text-success" },
  warning: { value: "text-foreground", icon: "text-warning" },
  destructive: { value: "text-foreground", icon: "text-destructive" },
};

/** A single metric tile: quiet label, prominent tabular value, optional icon. */
export function Metric({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  hint?: string;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <div className={cn("surface flex flex-col gap-1 p-4", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">{label}</span>
        {Icon && <Icon className={cn("size-3.5", t.icon)} />}
      </div>
      <div className={cn("tnum text-[26px] font-semibold leading-none tracking-tight", t.value)}>{value}</div>
      {hint && <span className="text-[11.5px] text-faint">{hint}</span>}
    </div>
  );
}

/** Eyebrow + title row that opens a section, with an optional trailing action. */
export function SectionHeading({
  eyebrow,
  title,
  action,
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">{eyebrow}</div>}
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
