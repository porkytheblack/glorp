/**
 * ⌘K command palette over workspaces + sessions (shadcn CommandDialog / cmdk).
 * Results are grouped and labeled by workspace; cmdk owns the search input,
 * fuzzy filtering, keyboard nav (↑/↓/Enter), and Esc-to-close. Each item's
 * `value` folds in title + id + workspace so a query matches any of them.
 */

import { useMemo } from "react";
import { CornerDownLeft, MessageSquare } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command.tsx";
import type { WorkspacesController } from "../state/useWorkspaces.ts";
import type { SessionDto } from "../types.ts";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  ws: WorkspacesController;
  onSelectSession: (id: string) => void;
}

function workspaceLabel(p: CommandPaletteProps, s: SessionDto): string {
  if (s.workspace_id) {
    const g = p.ws.groups.find((g) => g.workspace.id === s.workspace_id);
    if (g) return g.workspace.name;
  }
  return s.workspace.split("/").pop() || s.workspace;
}

export function CommandPalette(p: CommandPaletteProps) {
  const groups = useMemo(() => {
    const all = [...p.ws.sessionsById.values()].sort((a, b) => b.last_activity.localeCompare(a.last_activity));
    const byLabel = new Map<string, SessionDto[]>();
    for (const s of all) {
      const label = workspaceLabel(p, s);
      const list = byLabel.get(label);
      if (list) list.push(s);
      else byLabel.set(label, [s]);
    }
    return [...byLabel.entries()];
  }, [p.ws.sessionsById, p.ws.groups]);

  const choose = (s: SessionDto) => {
    p.onSelectSession(s.id);
    p.onClose();
  };

  return (
    <CommandDialog open={p.open} onOpenChange={(o) => !o && p.onClose()} className="max-w-xl">
      <CommandInput placeholder="Search chats…" />
      <CommandList>
        <CommandEmpty>No chats found.</CommandEmpty>
        {groups.map(([label, sessions]) => (
          <CommandGroup key={label} heading={label}>
            {sessions.map((s) => (
              <CommandItem
                key={s.id}
                value={`${s.title ?? ""} ${s.id} ${label}`}
                onSelect={() => choose(s)}
                className="group"
              >
                <MessageSquare size={14} className="shrink-0 text-glorp-muted" />
                <span className="min-w-0 flex-1 truncate text-glorp-text">{s.title || s.id}</span>
                <CornerDownLeft
                  size={14}
                  className="shrink-0 text-glorp-muted opacity-0 group-data-[selected=true]:opacity-100"
                />
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
