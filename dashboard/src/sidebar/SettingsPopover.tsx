/**
 * The pinned Settings button + an anchored popover (shadcn Popover) showing
 * Station's version/reachability (via `api.health()`) and an "Open settings"
 * action that routes to the full settings view. Self-contained: it owns its
 * trigger button so positioning is automatic.
 */

import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover.tsx";
import { api } from "../api/client.ts";

export interface SettingsPopoverProps {
  active: boolean;
  onOpenSettings: () => void;
}

type Health = { status: string; version: string } | "error" | null;

export function SettingsPopover(p: SettingsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<Health>(null);

  useEffect(() => {
    if (!open) return;
    setHealth(null);
    void api
      .health()
      .then((h) => setHealth(h))
      .catch(() => setHealth("error"));
  }, [open]);

  const ok = health && health !== "error";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-glorp-text hover:bg-glorp-surface-2 ${
            p.active || open ? "bg-glorp-surface-2" : ""
          }`}
        >
          <Settings size={16} className={`shrink-0 ${p.active || open ? "text-glorp-text" : "text-glorp-muted"}`} />
          Settings
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8} className="w-[248px] p-0">
        <div className="border-b border-glorp-border px-3 py-2.5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-glorp-muted">Glorp Station</div>
          <div className="mt-1.5 flex items-center gap-2 text-[13px] text-glorp-text">
            <span
              className={`h-2 w-2 rounded-full ${
                health === null ? "animate-pulse bg-glorp-muted" : ok ? "bg-glorp-success" : "bg-glorp-error"
              }`}
            />
            <span>
              {health === null
                ? "Checking…"
                : ok
                  ? `Connected · v${(health as { version: string }).version}`
                  : "Unreachable"}
            </span>
          </div>
        </div>
        <button
          onClick={() => {
            setOpen(false);
            p.onOpenSettings();
          }}
          className="group m-1 flex h-8 w-[calc(100%-0.5rem)] items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-glorp-text hover:bg-glorp-surface-2"
        >
          <Settings size={16} className="shrink-0 text-glorp-muted group-hover:text-glorp-text" />
          Open settings
        </button>
      </PopoverContent>
    </Popover>
  );
}
