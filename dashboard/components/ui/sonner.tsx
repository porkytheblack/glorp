"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/** App-wide toast surface, themed to graphite. Use `toast()` from sonner. */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
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
