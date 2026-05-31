import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";

/** Plain label styled as the app's section/field label (no Radix dep needed). */
export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn("text-[11px] font-medium uppercase tracking-wider text-glorp-muted", className)}
      {...props}
    />
  );
}
