"use client";

import * as React from "react";
import { Check, ChevronRight, CircleStop, FileText, Hammer, Pencil, Search, Terminal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/shared";
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

function StatusIcon({ status }: { status: ToolEvent["status"] }) {
  if (status === "running") return <Spinner className="size-3.5 text-muted-foreground" />;
  if (status === "success") return <Check className="size-3.5 text-success" />;
  if (status === "error") return <X className="size-3.5 text-destructive" />;
  return <CircleStop className="size-3.5 text-muted-foreground" />;
}

export function ToolCall({ tool }: { tool: ToolEvent }) {
  const [open, setOpen] = React.useState(false);
  const Icon = iconFor(tool.name);
  const summary = summarize(tool.input);
  const hasDetail = Boolean(summary) || Boolean(tool.output);

  return (
    <div className="rounded-lg border border-border bg-card/40">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px]", hasDetail && "hover:bg-secondary/40")}
      >
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90", !hasDetail && "opacity-0")} />
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono font-medium text-foreground">{tool.name}</span>
        {summary && <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{summary}</span>}
        <span className="ml-auto shrink-0">
          <StatusIcon status={tool.status} />
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-3 py-2.5">
          {typeof tool.input === "object" && tool.input !== null && (
            <pre className="overflow-x-auto rounded-md bg-background p-2.5 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
              {JSON.stringify(tool.input, null, 2)}
            </pre>
          )}
          {tool.output && (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-2.5 font-mono text-[11.5px] leading-relaxed text-foreground/80">
              {tool.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
