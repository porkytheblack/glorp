"use client";

import { useEffect, useState } from "react";
import { Boxes } from "lucide-react";
import { useQuery } from "@/lib/hooks";
import { getNamespace, setNamespace } from "@/lib/api";
import type { NamespaceDto } from "@/lib/types";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

const DEFAULT = "__default__";

/** Slim top bar: page title on the left, namespace scope switcher on the right. */
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
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/80 px-6 backdrop-blur-md">
      <h1 className="text-sm font-medium text-foreground">{title}</h1>
      <div className="flex items-center gap-2">
        <span className="hidden text-[11px] uppercase tracking-wider text-muted-foreground/70 sm:inline">Namespace</span>
        <Select value={ns} onValueChange={onChange}>
          <SelectTrigger className="h-8 w-[190px] text-[13px]">
            <span className="flex min-w-0 items-center gap-2">
              <Boxes className="size-3.5 shrink-0 text-muted-foreground" />
              <SelectValue />
            </span>
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
