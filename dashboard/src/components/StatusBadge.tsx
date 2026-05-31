import type { SessionLifecycle } from "../types.ts";

/** Per-state dot color + label. The dot is intentionally a small colored dot, not an icon. */
const STATE: Record<SessionLifecycle, { dot: string; label: string }> = {
  provisioning: { dot: "bg-glorp-warn", label: "Starting" },
  idle: { dot: "bg-glorp-muted", label: "Idle" },
  busy: { dot: "bg-glorp-accent", label: "Working" },
  error: { dot: "bg-glorp-error", label: "Error" },
  destroyed: { dot: "bg-glorp-border", label: "Closed" },
};

export function StatusBadge({ state, busy }: { state: SessionLifecycle; busy?: boolean }) {
  const effective: SessionLifecycle = busy ? "busy" : state;
  const { dot, label } = STATE[effective];
  const live = effective === "busy" || effective === "provisioning";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-glorp-muted">
      <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
        {live && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${dot}`} />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dot}`} />
      </span>
      {label}
    </span>
  );
}
