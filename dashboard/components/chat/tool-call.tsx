"use client";

import * as React from "react";
import { ChevronRight, FileText, Hammer, Pencil, Search, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolEvent } from "@/lib/types";

function iconFor(name: string) {
  const n = name.toLowerCase();
  if (/bash|shell|exec|terminal|run/.test(n)) return Terminal;
  if (/edit|write|str_replace|create|patch/.test(n)) return Pencil;
  if (/read|cat|open|file|view/.test(n)) return FileText;
  if (/grep|search|find|glob|ls/.test(n)) return Search;
  return Hammer;
}

/** A short, human summary of the tool's input for the collapsed header. */
function summarize(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  if (typeof input === "object") {
    const o = input as Record<string, unknown>;
    for (const k of ["command", "cmd", "file_path", "path", "pattern", "query", "url", "name", "title"]) {
      if (typeof o[k] === "string") return o[k] as string;
    }
    try {
      return JSON.stringify(o);
    } catch {
      return "";
    }
  }
  return String(input);
}

// Status reads as a single semantic dot — quiet machinery, not a loud icon.
const STATUS: Record<ToolEvent["status"], { dot: string; pulse?: boolean }> = {
  running: { dot: "bg-warning", pulse: true },
  success: { dot: "bg-success" },
  error: { dot: "bg-destructive" },
  aborted: { dot: "bg-faint" },
};

function StatusDot({ status }: { status: ToolEvent["status"] }) {
  const s = STATUS[status];
  return (
    <span className="relative grid size-2 place-items-center">
      {s.pulse && <span className={cn("absolute size-2 rounded-full opacity-60 animate-pulse-ring", s.dot)} />}
      <span className={cn("relative size-2 rounded-full", s.dot)} />
    </span>
  );
}

export function ToolCall({ tool }: { tool: ToolEvent }) {
  const [open, setOpen] = React.useState(false);
  const Icon = iconFor(tool.name);
  const summary = summarize(tool.input);
  const hasDetail = Boolean(summary) || Boolean(tool.output);
  const hasInputObj = typeof tool.input === "object" && tool.input !== null;

  return (
    <div className="ml-10 overflow-hidden rounded-md border border-border bg-surface-2/40">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        className={cn("flex w-full items-center gap-2 px-2.5 py-1.5 text-left", hasDetail && "transition-colors hover:bg-surface-2")}
      >
        <ChevronRight className={cn("size-3 shrink-0 text-faint transition-transform", open && "rotate-90", !hasDetail && "opacity-0")} />
        <Icon className="size-3 shrink-0 text-faint" />
        <span className="shrink-0 font-mono text-[12px] font-medium text-muted-foreground">{tool.name}</span>
        {summary && <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-faint">{summary}</span>}
        <span className="ml-auto shrink-0 pl-1.5">
          <StatusDot status={tool.status} />
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border/60 px-2.5 py-2.5">
          {hasInputObj && (
            <pre className="overflow-x-auto rounded-md border border-border bg-background p-2.5 font-mono text-[11.5px] leading-relaxed text-faint">
              {JSON.stringify(tool.input, null, 2)}
            </pre>
          )}
          {tool.output && (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-2.5 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
              {tool.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
