"use client";

import { ShieldAlert } from "lucide-react";
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

/** Inline approval card for a pending permission request — blocks the agent,
 *  so it reads urgent (warning-tinted) but composed. */
export function PermissionPrompt({
  slot,
  onResolve,
}: {
  slot: DisplaySlot;
  onResolve: (slotId: string, allow: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 shadow-sheen">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border border-warning/30 bg-warning/10 text-warning">
        <ShieldAlert className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-semibold text-foreground">Permission requested</p>
        <p className="mt-0.5 truncate font-mono text-[12px] text-muted-foreground">{describe(slot.input)}</p>
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
