"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/lib/theme";

/** App-wide toast surface, themed via tokens. Use `toast()` from sonner. */
export function Toaster(props: ToasterProps) {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "group bg-popover text-popover-foreground border border-border rounded-lg shadow-xl text-[13px]",
          description: "text-muted-foreground",
          actionButton: "bg-primary text-primary-foreground",
          cancelButton: "bg-secondary text-secondary-foreground",
          error: "[&_[data-icon]]:text-destructive",
          success: "[&_[data-icon]]:text-success",
        },
      }}
      style={{ "--normal-border": "hsl(var(--border))" } as React.CSSProperties}
      {...props}
    />
  );
}
