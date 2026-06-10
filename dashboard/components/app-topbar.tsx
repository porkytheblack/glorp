"use client";

import { useEffect, useState } from "react";
import { Boxes } from "lucide-react";
import { useQuery } from "@/lib/hooks";
import { getNamespace, setNamespace } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { NamespaceDto, SessionDto } from "@/lib/types";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

const DEFAULT = "__default__";

/** Live count of running sessions across the current namespace. */
function FleetPulse() {
  const { data } = useQuery<{ sessions: SessionDto[] }>("/sessions", [], 5000);
  const running = (data?.sessions ?? []).filter((s) => s.state === "busy" || s.state === "provisioning").length;
  const live = running > 0;
  return (
    <span className={cn("hidden items-center gap-1.5 text-[12px] font-medium sm:inline-flex", live ? "text-success" : "text-muted-foreground")}>
      <span className="relative grid size-2 place-items-center">
        {live && <span className="absolute size-2 rounded-full bg-success opacity-60 animate-pulse-ring" />}
        <span className={cn("relative size-2 rounded-full", live ? "bg-success" : "bg-faint")} />
      </span>
      {live ? `${running} running` : "all idle"}
    </span>
  );
}

/** Slim top bar: page title + live pulse on the left, namespace scope on the right. */
export function AppTopbar({ title }: { title: string }) {
  const { data } = useQuery<{ namespaces: NamespaceDto[] }>("/namespaces");
  const [ns, setNs] = useState<string>(DEFAULT);

  useEffect(() => {
    setNs(getNamespace() ?? DEFAULT);
  }, []);

  const onChange = (value: string) => {
    setNs(value);
    setNamespace(value === DEFAULT ? null : value);
    // Namespace scope affects every fetched list — reload to re-scope cleanly.
    window.location.reload();
  };

  const tenants = (data?.namespaces ?? []).filter((n) => !n.is_default);

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/70 px-6 backdrop-blur-xl">
      <div className="flex items-center gap-3.5">
        <h1 className="text-[13.5px] font-semibold tracking-tight text-foreground">{title}</h1>
        <span className="h-3.5 w-px bg-border" />
        <FleetPulse />
      </div>
      <div className="flex items-center gap-2">
        <span className="hidden whitespace-nowrap text-[10.5px] font-medium uppercase tracking-[0.12em] text-faint md:inline">Namespace</span>
        <Select value={ns} onValueChange={onChange}>
          <SelectTrigger className="h-8 w-[168px] whitespace-nowrap text-[13px]">
            <Boxes className="size-3.5 shrink-0 text-faint" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT}>default</SelectItem>
            {tenants.map((n) => (
              <SelectItem key={n.id} value={n.id}>
                {n.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </header>
  );
}
