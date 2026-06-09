"use client";

import { ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DisplaySlot } from "@/lib/types";

function describe(input: unknown): string {
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    for (const k of ["title", "tool", "name", "command", "summary", "message"]) {
      if (typeof o[k] === "string") return o[k] as string;
    }
  }
  return "The agent is requesting permission to run a tool.";
}

/** Inline approval card for a pending permission request. */
export function PermissionPrompt({
  slot,
  onResolve,
}: {
  slot: DisplaySlot;
  onResolve: (slotId: string, allow: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
      <ShieldQuestion className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">Permission requested</p>
        <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{describe(slot.input)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => onResolve(slot.slotId, false)}>
          Deny
        </Button>
        <Button size="sm" onClick={() => onResolve(slot.slotId, true)}>
          Allow
        </Button>
      </div>
    </div>
  );
}
