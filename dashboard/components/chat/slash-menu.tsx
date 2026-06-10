"use client";

import { SlashSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SlashCommand {
  name: string; // "/compact"
  description: string;
}

/** Autocomplete popover for "/" commands, anchored above the composer.
 *  Pure presentation — the composer owns filtering and keyboard state. */
export function SlashMenu({
  commands,
  activeIndex,
  onPick,
}: {
  commands: SlashCommand[];
  activeIndex: number;
  onPick: (cmd: SlashCommand) => void;
}) {
  if (commands.length === 0) return null;
  return (
    <div className="absolute bottom-full left-0 z-30 mb-2 w-full max-w-sm animate-pop-in rounded-lg border border-border bg-popover p-1 shadow-elevated">
      <div className="px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">Commands</div>
      <div className="max-h-56 overflow-y-auto">
        {commands.map((cmd, i) => (
          <button
            key={cmd.name}
            type="button"
            // preventDefault so the textarea keeps focus through the click
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(cmd);
            }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
              i === activeIndex ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:bg-surface-2/60",
            )}
          >
            <SlashSquare className={cn("size-3.5 shrink-0", i === activeIndex ? "text-brand" : "text-faint")} />
            <span className="font-mono text-[12.5px] text-foreground">{cmd.name}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-faint">{cmd.description}</span>
          </button>
        ))}
      </div>
      <div className="border-t border-border/60 px-2 py-1 text-[10.5px] text-faint">
        <kbd className="rounded border border-border bg-surface-2 px-1 font-mono text-[9px]">↑↓</kbd> navigate ·{" "}
        <kbd className="rounded border border-border bg-surface-2 px-1 font-mono text-[9px]">⇥</kbd> complete ·{" "}
        <kbd className="rounded border border-border bg-surface-2 px-1 font-mono text-[9px]">esc</kbd> dismiss
      </div>
    </div>
  );
}
