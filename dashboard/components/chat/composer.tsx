"use client";

import * as React from "react";
import { CircleStop, CornerDownLeft, SendHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Message composer: auto-growing textarea, Enter to send, Stop while busy. */
export function Composer({
  busy,
  disabled,
  onSend,
  onStop,
  controls,
}: {
  busy: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  controls?: React.ReactNode;
}) {
  const [text, setText] = React.useState("");
  const ref = React.useRef<HTMLTextAreaElement>(null);

  const grow = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  React.useEffect(grow, [text, grow]);

  const submit = () => {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText("");
  };

  return (
    <div className="border-t border-border bg-background px-4 py-3 md:px-6">
      <div className="flex w-full max-w-3xl items-end gap-2 rounded-xl border border-input bg-card px-3 py-2 shadow-sm transition-colors focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/30">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={disabled ? "Session offline…" : "Message Glorp — ⏎ to send, ⇧⏎ for a new line"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[13.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70 disabled:opacity-60"
        />
        {busy ? (
          <Button size="icon-sm" variant="secondary" onClick={onStop} title="Stop the agent" className="shrink-0">
            <CircleStop />
          </Button>
        ) : (
          <Button size="icon-sm" onClick={submit} disabled={!text.trim() || disabled} title="Send" className="shrink-0">
            <SendHorizontal />
          </Button>
        )}
      </div>
      <div className="mt-1.5 flex w-full max-w-3xl items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-1">{controls}</div>
        <p className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground/70">
          {busy ? (
            <span className="text-warning">Glorp is working…</span>
          ) : (
            <>
              <CornerDownLeft className="size-3" /> send <span className="mx-0.5">·</span> ⇧⏎ newline
            </>
          )}
        </p>
      </div>
    </div>
  );
}
