/**
 * Left sidebar (Codex-style): a utilities row, the collapsible "Workspaces"
 * tree (folders → chat sessions), and a Settings button pinned to the bottom
 * that opens an anchored popover. New-workspace / new-chat flows are real
 * modals. The `Sidebar` export + `SidebarProps` contract are consumed by
 * `AppShell.tsx` and must stay stable.
 */

import { useState } from "react";
import { Plus, Search, SquarePen } from "lucide-react";
import { WorkspaceTree } from "./WorkspaceTree.tsx";
import { SettingsPopover } from "./SettingsPopover.tsx";
import type { View } from "../views.ts";
import type { WorkspaceGroup, WorkspacesController } from "../state/useWorkspaces.ts";

export interface SidebarProps {
  ws: WorkspacesController;
  view: View;
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNavigate: (view: View) => void;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
  onNewChat: (workspaceId: string | null) => void;
  onNewWorkspace: () => void;
}

const util =
  "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-glorp-text hover:bg-glorp-surface-2";

export function Sidebar(p: SidebarProps) {
  // Folders are CLOSED by default; we remember the ones explicitly expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const openSet = expanded;

  const removeWorkspace = async (g: WorkspaceGroup) => {
    const count = g.sessions.length;
    const msg =
      count > 0
        ? `Remove "${g.workspace.name}" and its ${count} chat${count === 1 ? "" : "s"}?`
        : `Remove "${g.workspace.name}"?`;
    if (!window.confirm(msg)) return;
    await p.ws.removeWorkspace(g.workspace.id, count > 0).catch((e) => window.alert(String(e)));
  };

  return (
    <aside className="glass relative flex h-full w-[264px] shrink-0 flex-col border-r border-glorp-border">
      <div className="space-y-0.5 border-b border-glorp-border p-2">
        <button className={util} onClick={() => p.onNewChat(null)}>
          <SquarePen size={16} className="shrink-0 text-glorp-accent" /> New chat
        </button>
        <button className={`${util} group`} onClick={p.onOpenPalette}>
          <Search size={16} className="shrink-0 text-glorp-muted group-hover:text-glorp-text" /> Search
        </button>
      </div>

      <div className="flex items-center justify-between px-2.5 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-glorp-muted">
        <span>Workspaces</span>
        <button
          className="inline-flex h-6 w-6 items-center justify-center rounded text-glorp-muted hover:bg-glorp-surface-2 hover:text-glorp-text"
          onClick={p.onNewWorkspace}
          title="Add workspace"
          aria-label="Add workspace"
        >
          <Plus size={16} className="shrink-0" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <WorkspaceTree
          ws={p.ws}
          selectedSessionId={p.selectedSessionId}
          openSet={openSet}
          onToggle={toggle}
          onSelectSession={p.onSelectSession}
          onNewChatHere={(id) => p.onNewChat(id)}
          onRemoveWorkspace={removeWorkspace}
        />
        {p.ws.error && <p className="px-2 py-2 text-[12px] text-glorp-error">{p.ws.error}</p>}
      </div>

      <div className="border-t border-glorp-border p-2">
        <SettingsPopover active={p.view === "settings"} onOpenSettings={p.onOpenSettings} />
      </div>
    </aside>
  );
}
