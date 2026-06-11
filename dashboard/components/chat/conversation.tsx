"use client";

import * as React from "react";
import { ArrowDown, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Message, StreamingMessage } from "./message";
import { ToolCall } from "./tool-call";
import type { ChatTurn } from "@/lib/types";

function Thinking() {
  return (
    <div className="flex items-center gap-2 pl-10 text-[12px] text-faint">
      <span className="relative grid size-2 place-items-center">
        <span className="absolute size-2 rounded-full bg-brand opacity-60 animate-pulse-ring" />
        <span className="relative size-2 rounded-full bg-brand" />
      </span>
      Thinking…
    </div>
  );
}

export function Conversation({
  items,
  streaming,
  busy,
  userInitial,
  className,
}: {
  items: ChatTurn[];
  streaming: string;
  busy: boolean;
  userInitial?: string;
  className?: string;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = React.useState(true);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  React.useEffect(() => {
    if (!stuck) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, streaming, busy, stuck]);

  const jump = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setStuck(true);
  };

  const empty = items.length === 0 && !streaming;

  return (
    <div className={cn("relative min-h-0", className)}>
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto px-6 md:px-8">
        <div className="flex w-full flex-col gap-6 py-7">
          {empty ? (
            <div className="pt-10">
              <EmptyState icon={MessageSquare} title="Start the conversation" description="Send a message to put the agent to work in this session." />
            </div>
          ) : (
            items.map((t) =>
              t.kind === "tool" && t.tool ? <ToolCall key={t.id} tool={t.tool} /> : <Message key={t.id} turn={t} userInitial={userInitial} />,
            )
          )}
          {streaming && <StreamingMessage text={streaming} />}
          {busy && !streaming && !empty && <Thinking />}
        </div>
      </div>
      {!stuck && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button size="sm" variant="secondary" onClick={jump} className="pointer-events-auto shadow-elevated">
            <ArrowDown /> Jump to latest
          </Button>
        </div>
      )}
    </div>
  );
}
