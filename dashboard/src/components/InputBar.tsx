/**
 * Bottom input bar: message composer plus the TUI-style chrome line showing
 * the active model, permission mode, and context-window usage.
 */

import { useState } from "react";
import type { SessionState } from "../state/reducer.ts";
import type { SessionDto } from "../types.ts";

interface Props {
  session: SessionDto;
  state: SessionState;
  onSend: (text: string) => void;
  onAbort: () => void;
}

export function InputBar({ session, state, onSend, onAbort }: Props) {
  const [text, setText] = useState("");

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    onSend(value);
    setText("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const contextPct = state.stats?.contextPct ?? 0;

  return (
    <div className="border-t border-glorp-border bg-glorp-surface px-4 py-2">
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Message the agent…  (Enter to send, Shift+Enter for newline)"
          className="flex-1 resize-none rounded border border-glorp-border bg-glorp-bg px-3 py-2 text-glorp-text outline-none focus:border-glorp-accent"
        />
        {state.busy ? (
          <button
            onClick={onAbort}
            className="rounded border border-glorp-error px-3 py-2 text-glorp-error hover:bg-glorp-error/10"
          >
            Abort
          </button>
        ) : (
          <button
            onClick={submit}
            className="rounded bg-glorp-accent-dim px-4 py-2 text-glorp-text hover:bg-glorp-accent"
          >
            Send
          </button>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[11px] text-glorp-muted">
        <span>{session.model_label ?? "no model"}</span>
        <span>·</span>
        <span>{state.permissionMode}</span>
        <span>·</span>
        <span>{contextPct}% context</span>
        {state.stats && (
          <>
            <span>·</span>
            <span>{state.stats.tokens_in + state.stats.tokens_out} tok</span>
          </>
        )}
      </div>
    </div>
  );
}
