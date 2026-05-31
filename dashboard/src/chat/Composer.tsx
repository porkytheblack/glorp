/**
 * Message composer: an auto-sizing textarea (Enter sends, Shift+Enter newlines)
 * with a red primary send button — or a Stop button while the agent is busy.
 * Typing `@` or `/` at the start opens a frosted popover of subagents / slash
 * commands (↑/↓ to move, Enter/Tab to accept, Esc to dismiss); these are plain
 * text helpers — selecting just inserts the token and the agent parses it.
 * Below the field sits a chrome line of chips: the model label, the permission
 * mode (clickable → opens SessionSettings), the context %, and a workspace +
 * "Local" chip. Used both centered (empty state) and docked (active chat).
 */

import { useMemo, useRef, useState } from "react";
import { ArrowUp, Square, AtSign, Slash, CornerDownLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover.tsx";
import type { SessionState } from "../state/reducer.ts";
import type { SessionDto } from "../types.ts";

export interface ComposerProps {
  session: SessionDto;
  state: SessionState;
  workspaceName: string | null;
  onSend: (text: string) => void;
  onAbort: () => void;
  onOpenSettings: () => void;
}

interface MenuItem {
  token: string;
  hint: string;
}

const SUBAGENTS: MenuItem[] = [
  { token: "@planner", hint: "Break the task into a working plan" },
  { token: "@researcher", hint: "Gather context before changing code" },
  { token: "@reviewer", hint: "Audit the diff for issues" },
];

const COMMANDS: MenuItem[] = [
  { token: "/build", hint: "Implement the requested change" },
  { token: "/plan", hint: "Draft a plan without editing" },
  { token: "/diff", hint: "Show the working-tree diff" },
  { token: "/compact", hint: "Summarize and shrink the context" },
  { token: "/clear", hint: "Start a fresh conversation" },
  { token: "/concise", hint: "Reply tersely from now on" },
];

const MODE_LABEL: Record<string, string> = {
  normal: "Normal",
  auto: "Auto-review",
  bypass: "Full access",
};

const chip = "inline-flex items-center gap-1 rounded-full border border-glorp-border bg-glorp-surface-2 px-2.5 py-1 text-[12px] text-glorp-muted";

/** Picks the active menu (subagents / commands) and filters by the typed prefix. */
function useMenu(text: string) {
  return useMemo(() => {
    const head = text.split(/\s/, 1)[0] ?? "";
    if (text.length === 0 || /\s/.test(text)) return null;
    let icon: LucideIcon | null = null;
    let label = "";
    let source: MenuItem[] = [];
    if (head.startsWith("@")) { icon = AtSign; label = "Subagents"; source = SUBAGENTS; }
    else if (head.startsWith("/")) { icon = Slash; label = "Commands"; source = COMMANDS; }
    else return null;
    const needle = head.slice(1).toLowerCase();
    const items = source.filter((i) => i.token.slice(1).toLowerCase().startsWith(needle));
    return items.length ? { icon, label, items } : null;
  }, [text]);
}

function ComposerMenu(p: { label: string; icon: LucideIcon; items: MenuItem[]; cursor: number; onPick: (i: MenuItem) => void; onHover: (i: number) => void }) {
  const Icon = p.icon;
  return (
    <>
      <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-glorp-muted">
        <Icon size={12} className="shrink-0" />
        {p.label}
      </div>
      {p.items.map((it, i) => {
        const active = i === p.cursor;
        return (
          <button
            key={it.token}
            // Keep focus in the textarea so typing/Enter/Tab keep working.
            onMouseDown={(e) => e.preventDefault()}
            onMouseMove={() => p.onHover(i)}
            onClick={() => p.onPick(it)}
            className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left ${active ? "bg-glorp-surface-2" : "hover:bg-glorp-surface-2"}`}
          >
            <span className="shrink-0 font-mono text-[13px] text-glorp-text">{it.token}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-glorp-muted">{it.hint}</span>
            <CornerDownLeft size={14} className={`shrink-0 text-glorp-muted ${active ? "opacity-100" : "opacity-0"}`} />
          </button>
        );
      })}
    </>
  );
}

export function Composer(p: ComposerProps) {
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const busy = p.state.busy;
  const menu = useMenu(text);

  const submit = () => {
    const v = text.trim();
    if (!v) return;
    p.onSend(v);
    setText("");
    setCursor(0);
  };

  const pick = (it: MenuItem) => {
    setText(`${it.token} `);
    setCursor(0);
    taRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (menu) {
      if (e.key === "Escape") { e.preventDefault(); setText(""); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => (c + 1) % menu.items.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => (c - 1 + menu.items.length) % menu.items.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(menu.items[cursor] ?? menu.items[0]); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  const onChange = (v: string) => { setText(v); setCursor(0); };

  const mode = MODE_LABEL[p.state.permissionMode] ?? p.state.permissionMode;
  const ctx = p.state.stats?.contextPct;

  return (
    <div className="space-y-2">
      <Popover open={!!menu} onOpenChange={() => {}}>
        <PopoverAnchor asChild>
          <div className="glass-strong flex items-end gap-2 rounded-2xl border border-glorp-border px-3 py-2.5 focus-within:border-glorp-border-active">
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Do anything…"
              className="max-h-48 flex-1 resize-none bg-transparent leading-relaxed text-glorp-text outline-none placeholder:text-glorp-muted"
            />
            {busy ? (
              <button onClick={p.onAbort} title="Stop"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-glorp-error text-glorp-error hover:bg-glorp-error/10">
                <Square size={16} />
              </button>
            ) : (
              <button onClick={submit} disabled={!text.trim()} title="Send"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-glorp-accent text-white hover:bg-glorp-accent-dim disabled:opacity-40">
                <ArrowUp size={18} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </PopoverAnchor>
        {menu && (
          <PopoverContent
            side="top"
            align="start"
            sideOffset={8}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            className="w-[var(--radix-popover-trigger-width)] p-1.5"
          >
            <ComposerMenu
              label={menu.label}
              icon={menu.icon}
              items={menu.items}
              cursor={Math.min(cursor, menu.items.length - 1)}
              onPick={pick}
              onHover={setCursor}
            />
          </PopoverContent>
        )}
      </Popover>

      <div className="flex flex-wrap items-center gap-2">
        {p.session.model_label && <span className={chip}>{p.session.model_label}</span>}
        <button className={`${chip} hover:border-glorp-border-active hover:text-glorp-text`} onClick={p.onOpenSettings}>
          {mode}
        </button>
        {typeof ctx === "number" && <span className={chip}>{ctx}% ctx</span>}
        {p.workspaceName && (
          <span className={chip}>
            <span className="truncate text-glorp-text">{p.workspaceName}</span>
            <span className="text-glorp-muted">· Local</span>
          </span>
        )}
      </div>
    </div>
  );
}
