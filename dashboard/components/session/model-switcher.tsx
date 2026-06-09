"use client";

import Link from "next/link";
import { ChevronsUpDown, Cpu, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { ProfileWire } from "@/lib/types";

/** Inline model switcher for the composer — swaps the session's model live
 * (the web equivalent of the TUI's model picker). */
export function ModelSwitcher({
  profiles,
  current,
  onSwap,
}: {
  profiles: ProfileWire[];
  current: string | null;
  onSwap: (profileId: string, label: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-muted-foreground hover:text-foreground">
          <Cpu className="size-3.5" />
          <span className="max-w-[200px] truncate">{current ?? "Default model"}</span>
          <ChevronsUpDown className="size-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[240px]">
        <DropdownMenuLabel>Model for this session</DropdownMenuLabel>
        {profiles.length === 0 && <div className="px-2.5 py-1.5 text-[12.5px] text-muted-foreground">No profiles configured.</div>}
        {profiles.map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => onSwap(p.id, p.label)} className="justify-between gap-3">
            <span className="truncate">{p.label}</span>
            {p.reasoning_label && p.reasoning_label !== "off" && (
              <Badge variant="outline" className="shrink-0">
                {p.reasoning_label}
              </Badge>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/credentials">
            <Settings2 /> Manage models…
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
