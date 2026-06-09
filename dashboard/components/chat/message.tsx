"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { GarageMark } from "@/components/brand";
import { cn } from "@/lib/utils";
import { Md } from "./markdown";
import type { ChatTurn } from "@/lib/types";

function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} /> Reasoning
      </button>
      {open && (
        <div className="mt-1.5 border-l-2 border-border pl-3 text-[12.5px] italic leading-relaxed text-muted-foreground">
          {text}
        </div>
      )}
    </div>
  );
}

export function Message({ turn, userInitial = "U" }: { turn: ChatTurn; userInitial?: string }) {
  if (turn.kind === "system") {
    return (
      <div className="flex justify-center py-1">
        <span className={cn("rounded-full border px-3 py-1 text-[12px]", turn.error ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-border bg-secondary/50 text-muted-foreground")}>
          {turn.text}
        </span>
      </div>
    );
  }

  const isUser = turn.kind === "user";
  const imageCount = typeof turn.meta?.imageCount === "number" ? (turn.meta.imageCount as number) : 0;

  return (
    <div className="flex gap-3">
      <div className="shrink-0 pt-0.5">
        {isUser ? (
          <span className="grid size-7 place-items-center rounded-full bg-secondary text-[11px] font-medium text-foreground">{userInitial}</span>
        ) : (
          <span className="grid size-7 place-items-center rounded-full border border-brand/30 bg-brand/10 text-brand">
            <GarageMark className="size-4" spark={false} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-[12px] font-medium text-muted-foreground">{isUser ? "You" : "Glorp"}</div>
        {turn.reasoning && <Reasoning text={turn.reasoning} />}
        {turn.text &&
          (isUser ? (
            <p className="max-w-[78ch] whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-foreground/90">{turn.text}</p>
          ) : (
            <Md className="max-w-[78ch]">{turn.text}</Md>
          ))}
        {imageCount > 0 && <p className="mt-1 text-[12px] text-muted-foreground">+ {imageCount} image{imageCount === 1 ? "" : "s"}</p>}
      </div>
    </div>
  );
}

/** The in-progress assistant message (streaming text), with a blinking caret. */
export function StreamingMessage({ text }: { text: string }) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 pt-0.5">
        <span className="grid size-7 place-items-center rounded-full border border-brand/30 bg-brand/10 text-brand">
          <GarageMark className="size-4" spark={false} />
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-[12px] font-medium text-muted-foreground">Glorp</div>
        <Md className="max-w-[78ch]">{text}</Md>
        <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-caret-blink bg-brand align-middle" />
      </div>
    </div>
  );
}
