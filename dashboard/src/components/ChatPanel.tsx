/**
 * Center column: the session's conversation rendered from the event stream —
 * user/agent messages, tool calls (rich + expandable via ToolDetail), streaming
 * text, and permission prompts with approve/deny.
 */

import { useEffect, useRef } from "react";
import type { SessionController } from "../state/useSession.ts";
import type { ChatTurn, SessionDto } from "../types.ts";
import { InputBar } from "./InputBar.tsx";
import { ToolDetail } from "./ToolDetail.tsx";

function TurnView({ turn }: { turn: ChatTurn }) {
  if (turn.kind === "tool" && turn.tool) return <ToolDetail tool={turn.tool} />;
  if (turn.kind === "user") {
    return (
      <div className="ml-auto max-w-[80%] rounded-lg bg-glorp-surface-2 px-3 py-2 text-glorp-text ring-1 ring-glorp-border">
        {turn.text}
      </div>
    );
  }
  if (turn.kind === "system" || turn.kind === "transmission") {
    return <div className="text-center text-[12px] text-glorp-muted">{turn.text}</div>;
  }
  return <div className="max-w-[80%] whitespace-pre-wrap text-glorp-text">{turn.text}</div>;
}

interface ChatPanelProps {
  session: SessionDto | null;
  controller: SessionController;
  onOpenSettings?: () => void;
}

export function ChatPanel({ session, controller, onOpenSettings }: ChatPanelProps) {
  const { state, status, send, abort, approve, deny } = controller;
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.turns.length, state.streamingText, state.slots.length]);

  if (!session) {
    return (
      <main className="flex h-full items-center justify-center bg-glorp-bg text-glorp-muted">
        Select a session, or create one to get started.
      </main>
    );
  }

  return (
    <main className="flex h-full min-w-0 flex-col bg-glorp-bg">
      <header className="flex items-center justify-between border-b border-glorp-border px-4 py-2.5">
        <span className="truncate text-glorp-text">{state.title || session.title || session.id}</span>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-glorp-muted">{status === "open" ? "● live" : status}</span>
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              title="Session settings"
              className="rounded border border-glorp-border px-2 py-0.5 text-glorp-muted hover:border-glorp-accent hover:text-glorp-accent"
            >
              ⚙
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {state.turns.map((t) => (
          <TurnView key={t.id} turn={t} />
        ))}
        {state.streamingText && (
          <div className="max-w-[80%] whitespace-pre-wrap text-glorp-text opacity-90">{state.streamingText}</div>
        )}
        {state.slots.map((slot) => (
          <div key={slot.slotId} className="rounded-lg border border-glorp-warn/50 bg-glorp-surface px-3 py-2">
            <div className="mb-2 text-glorp-warn">
              {slot.isPermissionRequest ? "Permission requested" : `Input requested (${slot.renderer})`}
            </div>
            <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap text-[12px] text-glorp-muted">
              {JSON.stringify(slot.input, null, 2)}
            </pre>
            {slot.isPermissionRequest && (
              <div className="flex gap-2">
                <button
                  onClick={() => approve(slot.slotId)}
                  className="rounded bg-glorp-accent-dim px-3 py-1 text-glorp-text hover:bg-glorp-accent"
                >
                  Approve
                </button>
                <button
                  onClick={() => deny(slot.slotId)}
                  className="rounded border border-glorp-error px-3 py-1 text-glorp-error hover:bg-glorp-error/10"
                >
                  Deny
                </button>
              </div>
            )}
          </div>
        ))}
        {state.error && <div className="text-glorp-error">{state.error}</div>}
        <div ref={endRef} />
      </div>

      <InputBar session={session} state={state} onSend={send} onAbort={abort} />
    </main>
  );
}
