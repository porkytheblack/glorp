"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { GarageMark } from "@/components/brand";
import { cn } from "@/lib/utils";
import { Md } from "./markdown";
import { ErrorCard } from "./error-card";
import type { ChatTurn } from "@/lib/types";

/** The Glorp avatar glyph — quiet brand-tinted disc, shared by message + stream. */
function AgentGlyph() {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-full border border-brand/30 bg-brand/10 text-brand shadow-sheen">
      <GarageMark className="size-4" spark={false} />
    </span>
  );
}

function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-[12px] text-faint transition-colors hover:text-muted-foreground"
      >
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} /> Reasoning
      </button>
      {open && (
        <div className="mt-1.5 border-l-2 border-border/60 pl-3 text-[12px] italic leading-relaxed text-faint">{text}</div>
      )}
    </div>
  );
}

export function Message({ turn, userInitial = "U" }: { turn: ChatTurn; userInitial?: string }) {
  if (turn.kind === "system") {
    // Failed turns get the full actionable treatment, never a raw trace.
    if (turn.error) return <ErrorCard turn={turn} />;
    return (
      <div className="flex justify-center py-0.5">
        <span className="rounded-full border border-border bg-surface-2/60 px-3 py-1 text-[11.5px] text-faint">{turn.text}</span>
      </div>
    );
  }

  const isUser = turn.kind === "user";
  const imageCount = typeof turn.meta?.imageCount === "number" ? (turn.meta.imageCount as number) : 0;

  // User turns: a quiet inset block, visually distinct but not a loud bubble.
  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="text-[11px] font-medium uppercase tracking-wider text-faint">You</div>
        <div className="max-w-[85%] rounded-lg rounded-tr-sm border border-border bg-surface-2 px-3.5 py-2.5 shadow-sheen">
          {turn.text && <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-foreground">{turn.text}</p>}
          {imageCount > 0 && (
            <p className="mt-1 text-[12px] text-faint">+ {imageCount} image{imageCount === 1 ? "" : "s"}</p>
          )}
        </div>
      </div>
    );
  }

  // Agent turns: prose is the content — full-width, comfortable measure.
  return (
    <div className="flex gap-3">
      <div className="pt-0.5">
        <AgentGlyph />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-faint">Glorp</div>
        {turn.reasoning && <Reasoning text={turn.reasoning} />}
        {turn.text && <Md>{turn.text}</Md>}
        {imageCount > 0 && (
          <p className="mt-1 text-[12px] text-faint">+ {imageCount} image{imageCount === 1 ? "" : "s"}</p>
        )}
      </div>
    </div>
  );
}

/** The in-progress assistant message (streaming text), with a blinking caret. */
export function StreamingMessage({ text }: { text: string }) {
  return (
    <div className="flex gap-3">
      <div className="pt-0.5">
        <AgentGlyph />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-faint">Glorp</div>
        <Md>{text}</Md>
        <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-caret-blink bg-brand align-middle" />
      </div>
    </div>
  );
}
