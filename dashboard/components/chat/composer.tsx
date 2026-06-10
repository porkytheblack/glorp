"use client";

import * as React from "react";
import { CircleStop, SendHorizontal } from "lucide-react";
import { Spinner } from "@/components/shared";
import { Button } from "@/components/ui/button";

/** Message composer: auto-growing textarea, Enter to send, Stop while busy.
 *  Mirrors the Fleet LaunchComposer idiom — this screen's one glow moment. */
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
    <div className="border-t border-border bg-background px-4 py-3.5 md:px-6">
      <div className="group mx-auto w-full max-w-3xl rounded-xl border border-border bg-card p-2.5 shadow-card transition-shadow focus-within:border-brand/40 focus-within:shadow-glow">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={disabled ? "Session offline…" : "Message Glorp…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-[200px] min-h-[24px] w-full resize-none bg-transparent px-2.5 py-1.5 text-[13.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-2.5">
          <div className="flex min-w-0 items-center gap-1">{controls}</div>
          <div className="flex shrink-0 items-center gap-2.5">
            {busy ? (
              <>
                <span className="text-[11.5px] font-medium text-warning">Working…</span>
                <Button size="sm" variant="secondary" onClick={onStop} title="Stop the agent">
                  <CircleStop /> Stop
                </Button>
              </>
            ) : (
              <>
                <span className="hidden text-[11px] text-faint sm:inline">
                  <kbd className="rounded border border-border bg-surface-2 px-1 py-0.5 font-mono text-[10px]">↵</kbd> send
                  <span className="mx-1 text-faint/60">·</span>
                  <kbd className="rounded border border-border bg-surface-2 px-1 py-0.5 font-mono text-[10px]">⇧↵</kbd> newline
                </span>
                <Button size="sm" onClick={submit} disabled={!text.trim() || disabled} title="Send">
                  {disabled ? <Spinner /> : <SendHorizontal />} Send
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
