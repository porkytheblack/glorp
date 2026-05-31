import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";

export function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full rounded-md border border-glorp-border bg-glorp-bg px-3 text-[13px] text-glorp-text outline-none transition-colors placeholder:text-glorp-muted focus:border-glorp-border-active disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
