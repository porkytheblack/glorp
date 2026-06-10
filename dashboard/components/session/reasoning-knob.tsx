"use client";

import * as React from "react";
import { Brain, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import type { ProfileWire, ReasoningOption } from "@/lib/types";

/**
 * Reasoning-effort knob, inline in the composer next to the model switcher
 * (the Cursor convention). Changing the level rewrites the profile's
 * reasoning (`POST /models/profiles/:id/reasoning`) — which mints a new
 * profile id — and swaps the live session onto it.
 */
export function ReasoningKnob({
  profiles,
  currentLabel,
  onSwapped,
}: {
  profiles: ProfileWire[];
  currentLabel: string | null;
  onSwapped: (profileId: string, label: string) => void;
}) {
  const current = profiles.find((p) => p.label === currentLabel) ?? null;
  const [options, setOptions] = React.useState<ReasoningOption[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setOptions(null);
    if (!current) return;
    let cancelled = false;
    api<{ options: ReasoningOption[] }>(
      `/models/reasoning-options?provider=${encodeURIComponent(current.provider_id)}&model=${encodeURIComponent(current.model)}`,
    )
      .then((r) => !cancelled && setOptions(r.options ?? []))
      .catch(() => !cancelled && setOptions([]));
    return () => {
      cancelled = true;
    };
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // No profile match or a model with no reasoning levels: nothing to show.
  if (!current || options === null || options.length === 0) return null;

  const level = current.reasoning_label ?? "off";

  const pick = async (opt: ReasoningOption) => {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await api<ProfileWire>(`/models/profiles/${current.id}/reasoning`, {
        method: "POST",
        body: { reasoning: opt.value ?? { kind: "off" } },
      });
      onSwapped(updated.id, updated.label);
      toast.success(`Reasoning set to ${opt.label}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change reasoning");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-2/60 px-2.5 text-[12.5px] font-medium shadow-sheen transition-colors hover:bg-elevated",
            level !== "off" ? "text-brand-strong" : "text-muted-foreground",
          )}
          title="Reasoning effort"
        >
          <Brain className="size-3.5" />
          {level}
          <ChevronsUpDown className="size-3 text-faint" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-[230px]">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-faint">Reasoning effort</DropdownMenuLabel>
        {options.map((opt) => (
          <DropdownMenuItem key={opt.label} onClick={() => pick(opt)} className="flex flex-col items-start gap-0.5">
            <span className={cn("text-[13px]", opt.label === level && "text-brand-strong")}>{opt.label}</span>
            {opt.description && <span className="text-[11.5px] text-faint">{opt.description}</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
