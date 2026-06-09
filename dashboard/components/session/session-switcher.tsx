"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, MessageSquare } from "lucide-react";
import { useQuery } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { SessionDto } from "@/lib/types";

const DOT: Record<string, string> = {
  busy: "bg-warning",
  provisioning: "bg-warning",
  idle: "bg-muted-foreground/60",
  error: "bg-destructive",
  destroyed: "bg-muted-foreground/30",
};

/** Header switcher: jump between sessions without leaving the chat. Sessions
 * you started keep running server-side whether or not they're open here. */
export function SessionSwitcher({ currentId, title }: { currentId: string; title: string }) {
  const router = useRouter();
  const { data } = useQuery<{ sessions: SessionDto[] }>("/sessions");
  const sessions = [...(data?.sessions ?? [])].sort((a, b) => b.last_activity.localeCompare(a.last_activity));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="group flex min-w-0 items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
          <h1 className="truncate text-[17px] font-semibold tracking-tight">{title}</h1>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground opacity-50 transition-opacity group-hover:opacity-100" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] w-[300px] overflow-y-auto">
        <DropdownMenuLabel>Switch session</DropdownMenuLabel>
        {sessions.length === 0 && <div className="px-2.5 py-1.5 text-[12.5px] text-muted-foreground">No sessions.</div>}
        {sessions.map((s) => (
          <DropdownMenuItem key={s.id} onClick={() => router.push(`/sessions/${s.id}`)} className="gap-2.5">
            <span className={cn("size-1.5 shrink-0 rounded-full", DOT[s.state] ?? "bg-muted-foreground/60")} />
            <span className="min-w-0 flex-1 truncate">{s.title ?? "Untitled session"}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(s.last_activity)}</span>
            {s.id === currentId && <Check className="size-3.5 shrink-0 text-brand" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/sessions">
            <MessageSquare /> All sessions
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
