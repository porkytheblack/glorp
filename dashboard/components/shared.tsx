"use client";

import * as React from "react";
import { Check, Copy, LoaderCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Page title block: heading, optional supporting line, right-aligned actions. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-7 flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 max-w-[64ch] text-[13.5px] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Centered, calm empty state with a brand-tinted line icon. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex animate-fade-in flex-col items-center justify-center px-6 py-16 text-center", className)}>
      <div className="mb-4 grid size-12 place-items-center rounded-xl border border-border bg-surface-2 text-faint shadow-sheen">
        <Icon className="size-5" />
      </div>
      <p className="text-[14px] font-medium text-foreground">{title}</p>
      {description && <p className="mt-1.5 max-w-[42ch] text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, className }: { message: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/[0.07] px-4 py-3 text-[13px]",
        className,
      )}
    >
      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-destructive" />
      <span className="text-foreground/90">{message}</span>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn("size-4 animate-spin", className)} />;
}

export function Loading({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2.5 py-14 text-[13px] text-muted-foreground", className)}>
      <Spinner /> {label}
    </div>
  );
}

const STATUS: Record<string, { label: string; dot: string; tone: string; pulse?: boolean }> = {
  busy: { label: "running", dot: "bg-success", tone: "text-success", pulse: true },
  provisioning: { label: "provisioning", dot: "bg-warning", tone: "text-warning", pulse: true },
  idle: { label: "idle", dot: "bg-muted-foreground/60", tone: "text-muted-foreground" },
  error: { label: "error", dot: "bg-destructive", tone: "text-destructive" },
  destroyed: { label: "destroyed", dot: "bg-faint", tone: "text-faint" },
};

/** A quiet status indicator: a colored dot + label. Live states ripple. */
export function SessionStatus({ state, className }: { state: string; className?: string }) {
  const s = STATUS[state] ?? { label: state, dot: "bg-muted-foreground/60", tone: "text-muted-foreground" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12.5px] font-medium", s.tone, className)}>
      <span className="relative grid size-2 place-items-center">
        {s.pulse && <span className={cn("absolute size-2 rounded-full opacity-60 animate-pulse-ring", s.dot)} />}
        <span className={cn("relative size-2 rounded-full", s.dot)} />
      </span>
      {s.label}
    </span>
  );
}

/** Copy-to-clipboard icon button with a transient check. */
export function CopyButton({ value, className, label }: { value: string; className?: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <Button type="button" variant="ghost" size={label ? "sm" : "icon-sm"} className={cn("text-muted-foreground", className)} onClick={copy} title="Copy">
      {copied ? <Check className="text-success" /> : <Copy />}
      {label}
    </Button>
  );
}

/** Confirm-on-click destructive action. Stays inline; arms then confirms. */
export function ConfirmButton({ onConfirm, label = "Delete", icon: Icon }: { onConfirm: () => void; label?: string; icon?: LucideIcon }) {
  const [armed, setArmed] = React.useState(false);
  React.useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  if (armed) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Button variant="destructive" size="sm" onClick={onConfirm}>
          Confirm
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setArmed(false)}>
          Cancel
        </Button>
      </span>
    );
  }
  return (
    <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setArmed(true)}>
      {Icon && <Icon />}
      {label}
    </Button>
  );
}

/** Scroll container for list/detail pages: full height, centered max width. */
export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className={cn("mx-auto w-full max-w-[1180px] animate-fade-in px-6 py-8 md:px-9", className)}>{children}</div>
    </div>
  );
}

/** A revealed secret: monospace, full-width, with a copy affordance. */
export function SecretReveal({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-2 pl-3 shadow-sheen">
      <code className="min-w-0 flex-1 break-all font-mono text-[12.5px] text-foreground">{value}</code>
      <CopyButton value={value} />
    </div>
  );
}
