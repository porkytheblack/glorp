"use client";

import * as React from "react";
import { Check, ChevronsUpDown, CloudOff, CornerDownLeft, Eye, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";

type Fetched = { status: "loading" | "ok" | "error"; models: string[]; modalities?: Record<string, string[]>; error?: string };

/** Session-lived cache of live model lists, keyed by provider id. */
const liveCache = new Map<string, Fetched>();

/**
 * Model picker: searches the provider's OWN model list (fetched live through
 * the Garage, key server-side) with the static catalog as a fallback group and
 * a free-text escape hatch. No more typing model ids from memory.
 */
export function ModelCombobox({
  providerId,
  catalog,
  value,
  onChange,
  defaultOpen = false,
}: {
  providerId: string;
  catalog: string[];
  value: string;
  onChange: (model: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [search, setSearch] = React.useState("");
  const [live, setLive] = React.useState<Fetched | null>(providerId ? (liveCache.get(providerId) ?? null) : null);

  React.useEffect(() => {
    if (!open || !providerId) return;
    const cached = liveCache.get(providerId);
    if (cached && cached.status !== "error") {
      setLive(cached);
      return;
    }
    const loading: Fetched = { status: "loading", models: [] };
    liveCache.set(providerId, loading);
    setLive(loading);
    api<{ models: string[]; modalities?: Record<string, string[]> }>(`/models/providers/${providerId}/models`)
      .then((r) => {
        const ok: Fetched = { status: "ok", models: r.models ?? [], modalities: r.modalities };
        liveCache.set(providerId, ok);
        setLive(ok);
      })
      .catch((e) => {
        const err: Fetched = { status: "error", models: [], error: e instanceof Error ? e.message : "unavailable" };
        liveCache.set(providerId, err);
        setLive(err);
      });
  }, [open, providerId]);

  const liveModels = live?.status === "ok" ? live.models : [];
  const catalogExtra = catalog.filter((m) => !liveModels.includes(m));
  const exact = liveModels.includes(search) || catalogExtra.includes(search);

  const pick = (model: string) => {
    onChange(model);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={!providerId}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors",
            "hover:border-border-strong focus-visible:border-ring/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <span className={cn("truncate font-mono text-[12.5px]", value ? "text-foreground" : "font-sans text-[13px] text-muted-foreground/60")}>
            {value || "Pick a model…"}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-faint" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={live?.status !== "loading"}>
          <CommandInput placeholder="Search models…" value={search} onValueChange={setSearch} />
          <CommandList>
            {live?.status === "loading" && (
              <div className="space-y-1.5 p-2" aria-label="Loading models">
                {[88, 64, 76, 56].map((w, i) => (
                  <div key={i} className="skeleton h-6" style={{ width: `${w}%` }} />
                ))}
              </div>
            )}

            {live?.status === "error" && (
              <div className="flex items-start gap-2 border-b border-border/60 px-3 py-2.5 text-[12px] text-muted-foreground">
                <CloudOff className="mt-0.5 size-3.5 shrink-0 text-faint" />
                Live list unavailable — pick from the catalog or type a model id.
              </div>
            )}

            {live?.status !== "loading" && <CommandEmpty>No matching models.</CommandEmpty>}

            {liveModels.length > 0 && (
              <CommandGroup heading={`From ${providerId}`}>
                {liveModels.map((m, i) => (
                  <CommandItem key={m} value={m} onSelect={pick} className="animate-slide-up font-mono text-[12.5px]" style={{ animationDelay: `${Math.min(i, 12) * 18}ms`, animationFillMode: "backwards" }}>
                    <Sparkles className="size-3.5 text-brand/70" />
                    <span className="flex-1 truncate">{m}</span>
                    {live?.modalities?.[m]?.includes("image") && <Eye className="size-3 text-faint" aria-label="vision-capable" />}
                    <Check className={cn("size-3.5 text-brand transition-opacity", value === m ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {catalogExtra.length > 0 && live?.status !== "loading" && (
              <CommandGroup heading="Catalog">
                {catalogExtra.map((m, i) => (
                  <CommandItem key={m} value={m} onSelect={pick} className="animate-slide-up font-mono text-[12.5px] text-muted-foreground" style={{ animationDelay: `${Math.min(liveModels.length + i, 14) * 18}ms`, animationFillMode: "backwards" }}>
                    <span className="size-3.5" />
                    <span className="flex-1 truncate">{m}</span>
                    <Check className={cn("size-3.5 text-brand transition-opacity", value === m ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {search.trim() && !exact && live?.status !== "loading" && (
              <CommandGroup forceMount heading="Custom">
                <CommandItem value={search} onSelect={() => pick(search.trim())} className="text-[13px]">
                  <CornerDownLeft className="size-3.5 text-faint" />
                  <span className="truncate">
                    Use “<span className="font-mono text-[12.5px]">{search.trim()}</span>”
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
