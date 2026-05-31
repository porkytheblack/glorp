/**
 * Multi-agent roster modal (TUI parity). Lists the session's agents — the
 * active one marked with CircleCheck, busy ones with a Loader2 spinner, each
 * showing role + turn count — and lets you Switch, Add (pick a role), and
 * Remove agents. Every mutation refreshes from the roster the API returns.
 */

import { useEffect, useState } from "react";
import { Plus, Trash2, CircleCheck, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { api, type AgentInfo } from "../api/client.ts";

export interface AgentRosterProps {
  sessionId: string;
  onClose: () => void;
}

const ROLES = ["general", "researcher", "reviewer", "planner", "builder"];
const heading = "mb-1.5 text-[11px] font-medium uppercase tracking-wider text-glorp-muted";

export function AgentRoster(p: AgentRosterProps) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const apply = (r: { agents: AgentInfo[] }) => setAgents(r.agents);

  useEffect(() => {
    void api.agents(p.sessionId).then(apply).catch(() => {});
  }, [p.sessionId]);

  const run = (fn: () => Promise<{ agents: AgentInfo[] }>) => {
    setBusy(true);
    void fn().then(apply).catch((e) => window.alert(String(e))).finally(() => setBusy(false));
  };
  const switchTo = (id: string) => run(() => api.switchAgent(p.sessionId, id));
  const add = (role: string) => {
    setAdding(false);
    run(() => api.addAgent(p.sessionId, role));
  };
  const remove = (a: AgentInfo) => {
    if (!window.confirm(`Remove agent "${a.label}"?`)) return;
    run(() => api.removeAgent(p.sessionId, a.id));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle>Agents</DialogTitle>
        </DialogHeader>

        <section className="space-y-1">
          {agents.length === 0 ? (
            <p className="px-2.5 py-2 text-glorp-muted">No agents yet.</p>
          ) : (
            agents.map((a) => {
              const locked = a.active || a.id === "main";
              return (
                <div key={a.id} className="flex items-center gap-2 rounded-md px-2.5 py-2 hover:bg-glorp-surface-2">
                  {a.busy ? (
                    <Loader2 size={16} className="shrink-0 animate-spin text-glorp-muted" />
                  ) : a.active ? (
                    <CircleCheck size={16} className="shrink-0 text-glorp-success" />
                  ) : (
                    <span className="inline-block h-4 w-4 shrink-0" />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-glorp-text">{a.label}</span>
                    <span className="text-[12px] text-glorp-muted">
                      {a.role} · {a.turnCount} turns
                    </span>
                  </span>
                  {!a.active && (
                    <button
                      className="rounded-md border border-glorp-border px-2 py-1 text-[12px] text-glorp-text hover:bg-glorp-surface-2 disabled:opacity-40"
                      disabled={busy}
                      onClick={() => switchTo(a.id)}
                    >
                      Switch
                    </button>
                  )}
                  <button
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-glorp-muted hover:bg-glorp-surface-2 hover:text-glorp-error disabled:opacity-40"
                    title="Remove agent"
                    disabled={busy || locked}
                    onClick={() => remove(a)}
                  >
                    <Trash2 size={16} className="shrink-0" />
                  </button>
                </div>
              );
            })
          )}
        </section>

        <section>
          {adding ? (
            <>
              <div className={heading}>Add agent — pick a role</div>
              <div className="flex flex-wrap gap-1.5">
                {ROLES.map((r) => (
                  <button
                    key={r}
                    className="rounded-md border border-glorp-border px-2.5 py-1 text-[12px] text-glorp-text hover:bg-glorp-surface-2 disabled:opacity-40"
                    disabled={busy}
                    onClick={() => add(r)}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <button
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-glorp-accent hover:bg-glorp-surface-2"
              onClick={() => setAdding(true)}
            >
              <Plus size={16} className="shrink-0" /> Add agent
            </button>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
