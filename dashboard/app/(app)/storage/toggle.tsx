"use client";

import { cn } from "@/lib/utils";

/**
 * A compact on/off switch built from design tokens (no shadcn Switch exists in
 * this kit). Brand-tinted track when on, quiet `surface-2` when off; the same
 * focus ring as every other control.
 */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[22px] w-9 shrink-0 items-center rounded-full border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-brand/40 bg-brand/80 shadow-sheen" : "border-border bg-surface-2",
      )}
    >
      <span
        className={cn(
          "inline-block size-[16px] rounded-full bg-background shadow-sm transition-transform",
          checked ? "translate-x-[16px]" : "translate-x-[3px]",
        )}
      />
    </button>
  );
}
