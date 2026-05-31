/**
 * Header for the active chat: title (+ active-agent chip) on the left; action
 * buttons on the right — an info Popover (id / workspace / tokens / turns /
 * state), Agents + Permissions modals, a reasoning toggle, a panel-toggle, and
 * a "more" DropdownMenu (Settings, Abort, Destroy session via api.destroySession).
 */

import { Info, PanelRight, MoreHorizontal, Users, ShieldCheck, Brain } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover.tsx";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu.tsx";
import { api } from "../api/client.ts";
import type { SessionState } from "../state/reducer.ts";
import type { SessionDto } from "../types.ts";

export interface SessionTopBarProps {
  session: SessionDto;
  state: SessionState;
  workspaceName: string | null;
  panelOpen: boolean;
  showReasoning: boolean;
  activeAgentLabel?: string | null;
  onToggleReasoning: () => void;
  onOpenAgents: () => void;
  onOpenPermissions: () => void;
  onTogglePanel: () => void;
  onOpenSettings: () => void;
  onAbort: () => void;
  onDestroyed: () => void;
}

const iconBtn =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-glorp-muted hover:bg-glorp-surface-2 hover:text-glorp-text";

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-glorp-muted">{label}</dt>
      <dd className="truncate text-glorp-text">{value}</dd>
    </div>
  );
}

export function SessionTopBar(p: SessionTopBarProps) {
  const { session, state } = p;
  const title = state.title || session.title || session.id;

  const destroy = () => {
    if (!window.confirm("Destroy this session? This cannot be undone.")) return;
    void api.destroySession(session.id).then(p.onDestroyed).catch((e) => window.alert(String(e)));
  };

  return (
    <header className="glass flex shrink-0 items-center justify-between border-b border-glorp-border px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-glorp-text">{title}</span>
        {p.activeAgentLabel && (
          <span className="shrink-0 truncate rounded-md bg-glorp-surface-2 px-2 py-0.5 text-[12px] text-glorp-muted">
            {p.activeAgentLabel}
          </span>
        )}
      </div>

      <div className="flex items-center gap-0.5">
        <Popover>
          <PopoverTrigger asChild>
            <button className={iconBtn} title="Session info">
              <Info size={16} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={8} className="w-72 p-3">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-glorp-muted">Session</div>
            <dl className="space-y-1.5 text-[13px]">
              <InfoRow label="ID" value={session.id} />
              <InfoRow label="Workspace" value={p.workspaceName ?? session.workspace} />
              <InfoRow label="State" value={session.busy ? "busy" : session.state} />
              <InfoRow label="Turns" value={state.stats?.turns ?? session.turn_count} />
              <InfoRow label="Tokens in" value={state.stats?.tokens_in ?? session.tokens_in} />
              <InfoRow label="Tokens out" value={state.stats?.tokens_out ?? session.tokens_out} />
            </dl>
          </PopoverContent>
        </Popover>

        <button className={iconBtn} title="Agents" onClick={p.onOpenAgents}>
          <Users size={16} />
        </button>
        <button className={iconBtn} title="Permissions" onClick={p.onOpenPermissions}>
          <ShieldCheck size={16} />
        </button>
        <button
          className={`${iconBtn} ${p.showReasoning ? "bg-glorp-surface-2 text-glorp-text" : ""}`}
          title={p.showReasoning ? "Hide reasoning" : "Show reasoning"}
          onClick={p.onToggleReasoning}
        >
          <Brain size={16} className={p.showReasoning ? "" : "opacity-60"} />
        </button>
        <button
          className={`${iconBtn} ${p.panelOpen ? "bg-glorp-surface-2 text-glorp-text" : ""}`}
          title="Toggle context panel"
          onClick={p.onTogglePanel}
        >
          <PanelRight size={16} />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={iconBtn} title="More">
              <MoreHorizontal size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className="w-52">
            <DropdownMenuItem onSelect={() => p.onOpenSettings()}>Settings</DropdownMenuItem>
            <DropdownMenuItem disabled={!state.busy} onSelect={() => p.onAbort()}>
              Abort run
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={destroy}>
              Destroy session
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
