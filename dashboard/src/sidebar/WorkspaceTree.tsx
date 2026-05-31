/**
 * The "Workspaces" body: collapsible folders (one per workspace) that expand to
 * reveal their chat sessions, plus a subtle "Other" group for legacy sessions
 * with no first-class workspace. Open/closed state lives in the parent Sidebar
 * so it survives the workspace poll refresh.
 */

import { ChevronRight, Folder as FolderIcon, FolderOpen, Plus, Trash2 } from "lucide-react";
import type { SessionDto } from "../types.ts";
import type { WorkspaceGroup, WorkspacesController } from "../state/useWorkspaces.ts";
import { StatusBadge } from "../components/StatusBadge.tsx";

const ROW_ACTION =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-glorp-muted opacity-0 transition hover:bg-glorp-surface-2 hover:text-glorp-text group-hover:opacity-100";

export interface WorkspaceTreeProps {
  ws: WorkspacesController;
  selectedSessionId: string | null;
  openSet: Set<string>;
  onToggle: (id: string) => void;
  onSelectSession: (id: string) => void;
  onNewChatHere: (workspaceId: string) => void;
  onRemoveWorkspace: (group: WorkspaceGroup) => void;
}

function SessionRow(p: { session: SessionDto; selected: boolean; onSelect: () => void }) {
  const s = p.session;
  return (
    <button
      onClick={p.onSelect}
      className={`relative flex w-full flex-col gap-1 rounded-md px-2.5 py-1.5 pl-7 text-left text-[13px] hover:bg-glorp-surface-2 ${
        p.selected
          ? "bg-glorp-surface-2 text-glorp-text before:absolute before:left-1 before:top-1/2 before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-glorp-accent"
          : "text-glorp-text"
      }`}
    >
      <span className="truncate">{s.title || s.id}</span>
      <StatusBadge state={s.state} busy={s.busy} />
    </button>
  );
}

function Folder(p: {
  group: WorkspaceGroup;
  open: boolean;
  selectedSessionId: string | null;
  onToggle: () => void;
  onSelectSession: (id: string) => void;
  onNewChatHere: () => void;
  onRemove: () => void;
}) {
  const { workspace, sessions } = p.group;
  return (
    <div className="mb-0.5">
      <div className="group flex h-8 items-center gap-1 rounded-md px-2.5 hover:bg-glorp-surface-2">
        <button
          onClick={p.onToggle}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] text-glorp-text"
        >
          <ChevronRight
            size={14}
            className={`shrink-0 text-glorp-muted transition-transform ${p.open ? "rotate-90" : ""}`}
          />
          {p.open ? (
            <FolderOpen size={16} className="shrink-0 text-glorp-muted" />
          ) : (
            <FolderIcon size={16} className="shrink-0 text-glorp-muted" />
          )}
          <span className="truncate" title={workspace.path}>
            {workspace.name}
          </span>
        </button>
        <button onClick={p.onNewChatHere} title="New chat here" aria-label="New chat here" className={ROW_ACTION}>
          <Plus size={14} className="shrink-0" />
        </button>
        <button
          onClick={p.onRemove}
          title="Remove workspace"
          aria-label="Remove workspace"
          className={`${ROW_ACTION} hover:text-glorp-error`}
        >
          <Trash2 size={14} className="shrink-0" />
        </button>
      </div>
      {p.open && (
        <div className="mt-0.5 space-y-0.5">
          {sessions.length === 0 && (
            <p className="px-2.5 py-1 pl-7 text-[12px] text-glorp-muted">No chats yet.</p>
          )}
          {sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              selected={s.id === p.selectedSessionId}
              onSelect={() => p.onSelectSession(s.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkspaceTree(p: WorkspaceTreeProps) {
  const hasOther = p.ws.ungrouped.length > 0;

  if (p.ws.groups.length === 0 && !hasOther) {
    return (
      <p className="px-2.5 py-3 text-[13px] text-glorp-muted">
        No workspaces yet. Use the add button above to point Glorp at a folder.
      </p>
    );
  }

  return (
    <div className="space-y-0.5">
      {p.ws.groups.map((g) => (
        <Folder
          key={g.workspace.id}
          group={g}
          open={p.openSet.has(g.workspace.id)}
          selectedSessionId={p.selectedSessionId}
          onToggle={() => p.onToggle(g.workspace.id)}
          onSelectSession={p.onSelectSession}
          onNewChatHere={() => p.onNewChatHere(g.workspace.id)}
          onRemove={() => p.onRemoveWorkspace(g)}
        />
      ))}

      {hasOther && (
        <div className="mt-2">
          <div className="px-2.5 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-glorp-muted">
            Other
          </div>
          <div className="space-y-0.5">
            {p.ws.ungrouped.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                selected={s.id === p.selectedSessionId}
                onSelect={() => p.onSelectSession(s.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
