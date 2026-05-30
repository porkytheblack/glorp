/**
 * Left column: workspaces grouping their sessions, a new-session action, and
 * the available setup templates. v1 uses lightweight prompts for creation;
 * the proper create dialog is a follow-up for the UI team.
 */

import { useEffect, useState } from "react";
import { api, type TemplateSummary } from "../api/client.ts";
import type { SessionDto } from "../types.ts";
import { StatusBadge } from "./StatusBadge.tsx";
import { NewSessionDialog } from "./NewSessionDialog.tsx";

interface Props {
  sessions: SessionDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreated: (id: string) => void;
}

function workspaceLabel(p: string): string {
  if (!p) return "(no workspace)";
  const parts = p.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || p;
}

export function Sidebar({ sessions, selectedId, onSelect, onCreated }: Props) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    void api.templates().then((r) => setTemplates(r.templates)).catch(() => {});
  }, []);

  const groups = new Map<string, SessionDto[]>();
  for (const s of sessions) {
    const key = s.workspace || "(no workspace)";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(s);
  }

  const createFromTemplate = async (name: string) => {
    try {
      const s = await api.createSession({ template: name });
      onCreated(s.id);
    } catch (err) {
      window.alert(`Template create failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <aside className="flex h-full flex-col border-r border-glorp-border bg-glorp-surface">
      <div className="flex items-center justify-between border-b border-glorp-border px-3 py-2.5">
        <span className="font-semibold text-glorp-text">glorp</span>
        <button
          onClick={() => setDialogOpen(true)}
          className="rounded border border-glorp-border px-2 py-0.5 text-xs text-glorp-accent hover:border-glorp-accent"
        >
          + New
        </button>
      </div>
      <NewSessionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={(id) => {
          setDialogOpen(false);
          onCreated(id);
        }}
      />

      <div className="flex-1 overflow-y-auto">
        {[...groups.entries()].map(([ws, items]) => (
          <div key={ws} className="px-2 py-1.5">
            <div className="truncate px-1 py-1 text-[11px] uppercase tracking-wide text-glorp-muted" title={ws}>
              {workspaceLabel(ws)}
            </div>
            {items.map((s) => (
              <button
                key={s.id}
                onClick={() => onSelect(s.id)}
                className={`flex w-full flex-col gap-1 rounded px-2 py-1.5 text-left hover:bg-glorp-surface-2 ${
                  s.id === selectedId ? "bg-glorp-surface-2 ring-1 ring-glorp-border" : ""
                }`}
              >
                <span className="truncate text-glorp-text">{s.title || s.id}</span>
                <StatusBadge state={s.state} busy={s.busy} />
              </button>
            ))}
          </div>
        ))}
        {sessions.length === 0 && (
          <p className="px-3 py-4 text-glorp-muted">No sessions yet. Click + New to start one.</p>
        )}
      </div>

      {templates.length > 0 && (
        <div className="border-t border-glorp-border px-2 py-2">
          <div className="px-1 pb-1 text-[11px] uppercase tracking-wide text-glorp-muted">Templates</div>
          {templates.map((t) => (
            <button
              key={t.name}
              onClick={() => createFromTemplate(t.name)}
              title={t.description ?? undefined}
              className="block w-full truncate rounded px-2 py-1 text-left text-glorp-text hover:bg-glorp-surface-2"
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
