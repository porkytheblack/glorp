import type { SessionLifecycle } from "../types.ts";

const COLOR: Record<SessionLifecycle, string> = {
  provisioning: "bg-glorp-warn",
  idle: "bg-glorp-muted",
  busy: "bg-glorp-accent",
  error: "bg-glorp-error",
  destroyed: "bg-glorp-border",
};

export function StatusBadge({ state, busy }: { state: SessionLifecycle; busy?: boolean }) {
  const effective: SessionLifecycle = busy ? "busy" : state;
  return (
    <span className="inline-flex items-center gap-1.5 text-glorp-muted">
      <span className={`h-2 w-2 rounded-full ${COLOR[effective]} ${effective === "busy" ? "animate-pulse" : ""}`} />
      <span className="text-[11px] uppercase tracking-wide">{effective}</span>
    </span>
  );
}
