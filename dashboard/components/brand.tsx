import { cn } from "@/lib/utils";

/**
 * The Garage mark — a minimal archway (the garage opening / sandbox) with a
 * roller door and a single "spark" inside: the agent at work within the
 * sandbox. Drawn in currentColor so it inherits text color; the spark is the
 * one deliberate touch of brand accent. Reads cleanly from 16px to 64px.
 */
export function GarageMark({ className, spark = true }: { className?: string; spark?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      {/* archway: two legs rising to a rounded top */}
      <path
        d="M4 21V11a8 8 0 0 1 16 0v10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* threshold / ground line */}
      <path d="M2.5 21h19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      {/* roller door */}
      <path
        d="M8 21v-4.6h8V21"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 18.5h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.45" />
      {/* the agent, working inside */}
      <circle cx="12" cy="9.6" r="1.55" fill={spark ? "hsl(var(--brand))" : "currentColor"} />
    </svg>
  );
}

/** Mark + wordmark lockup for the sidebar / login. */
export function BrandLockup({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="grid size-8 place-items-center rounded-lg border border-border bg-surface-2 text-foreground shadow-sheen">
        <GarageMark className={cn("size-[18px]", markClassName)} />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">Garage</span>
    </span>
  );
}
