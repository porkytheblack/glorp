/**
 * The conversation stream. Core design intent: only the user's submitted
 * request gets a bubble, and it's *very* subtle (surface/40 + hairline ring).
 * Agent text, tool calls, and diffs render inline with no bubble. Live
 * streaming text and pending permission slots render inline too. Auto-scrolls
 * to the bottom whenever new content lands.
 */

import { useEffect, useRef } from "react";
import type { SessionState } from "../state/reducer.ts";
import type { ChatTurn, DisplaySlotEvent } from "../types.ts";
import { ToolDetail } from "../components/ToolDetail.tsx";

export interface MessageListProps {
  state: SessionState;
  showReasoning: boolean;
  onApprove: (slotId: string) => void;
  onDeny: (slotId: string) => void;
}

function Turn({ turn, showReasoning }: { turn: ChatTurn; showReasoning: boolean }) {
  if (turn.kind === "tool" && turn.tool) return <ToolDetail tool={turn.tool} />;
  if (turn.kind === "user") {
    return (
      <div className="ml-auto max-w-[78%] rounded-2xl bg-glorp-surface/40 px-3.5 py-2.5 ring-1 ring-glorp-border/60">
        <p className="whitespace-pre-wrap leading-7 text-glorp-text">{turn.text}</p>
      </div>
    );
  }
  if (turn.kind === "system" || turn.kind === "transmission") {
    return <div className="text-center text-[12px] text-glorp-muted">{turn.text}</div>;
  }
  return (
    <div>
      {showReasoning && turn.reasoning && (
        <div className="mb-1.5 whitespace-pre-wrap text-[12px] italic leading-6 text-glorp-muted">{turn.reasoning}</div>
      )}
      <div className="whitespace-pre-wrap leading-7 text-glorp-text">{turn.text}</div>
    </div>
  );
}

function SlotCard({ slot, onApprove, onDeny }: { slot: DisplaySlotEvent; onApprove: (id: string) => void; onDeny: (id: string) => void }) {
  return (
    <div className="rounded-xl border border-glorp-warn/50 bg-glorp-surface px-3.5 py-3">
      <div className="mb-2 text-[13px] font-medium text-glorp-warn">
        {slot.isPermissionRequest ? "Permission requested" : `Input requested (${slot.renderer})`}
      </div>
      <pre className="mb-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-glorp-border bg-glorp-bg px-2 py-1.5 font-mono text-[12px] text-glorp-muted">
        {JSON.stringify(slot.input, null, 2)}
      </pre>
      {slot.isPermissionRequest && (
        <div className="flex gap-2">
          <button onClick={() => onApprove(slot.slotId)}
            className="rounded-lg bg-glorp-accent px-3 py-1.5 text-[13px] text-white hover:bg-glorp-accent-dim">Approve</button>
          <button onClick={() => onDeny(slot.slotId)}
            className="rounded-lg border border-glorp-error px-3 py-1.5 text-[13px] text-glorp-error hover:bg-glorp-error/10">Deny</button>
        </div>
      )}
    </div>
  );
}

export function MessageList(p: MessageListProps) {
  // The bounded scroll container is owned here. Auto-scroll pins to the bottom
  // by setting scrollTop directly — never `scrollIntoView`, which also scrolls
  // ancestor containers and overshoots. A "stick to bottom" flag, updated on
  // scroll, means we only auto-pin when the user is already at the bottom, so
  // reading scrollback is never yanked.
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const { state } = p;

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [state.turns.length, state.streamingText, state.slots.length, state.error]);

  return (
    <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
        {state.turns.map((t) => <Turn key={t.id} turn={t} showReasoning={p.showReasoning} />)}
        {state.streamingText && (
          <div className="whitespace-pre-wrap leading-7 text-glorp-text opacity-90">
            {state.streamingText}
          </div>
        )}
        {state.slots.map((slot) => (
          <SlotCard key={slot.slotId} slot={slot} onApprove={p.onApprove} onDeny={p.onDeny} />
        ))}
        {state.error && (
          <div className="rounded-xl border border-glorp-error/50 bg-glorp-error/5 px-3.5 py-2.5 text-[13px] text-glorp-error">
            {state.error}
          </div>
        )}
      </div>
    </div>
  );
}
