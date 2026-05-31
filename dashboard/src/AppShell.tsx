/**
 * The Codex-style shell: a persistent left sidebar + the active view. Owns the
 * single live session WebSocket (via useSession) so it survives view changes,
 * plus the workspace data layer and the command-palette overlay.
 */

import { useCallback, useEffect, useState } from "react";
import { useWorkspaces } from "./state/useWorkspaces.ts";
import { useSession } from "./state/useSession.ts";
import { Sidebar } from "./sidebar/Sidebar.tsx";
import { ChatView } from "./chat/ChatView.tsx";
import { SettingsPage } from "./settings/SettingsPage.tsx";
import { CommandPalette } from "./palette/CommandPalette.tsx";
import { NewChatScreen } from "./screens/NewChatScreen.tsx";
import { NewProjectScreen } from "./screens/NewProjectScreen.tsx";
import type { View } from "./views.ts";

export function AppShell() {
  const ws = useWorkspaces();
  const [view, setView] = useState<View>("chat");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newChatWorkspaceId, setNewChatWorkspaceId] = useState<string | null>(null);

  const controller = useSession(selectedId);
  const session = selectedId ? ws.sessionsById.get(selectedId) ?? null : null;
  const workspaceName = session?.workspace_id
    ? ws.groups.find((g) => g.workspace.id === session.workspace_id)?.workspace.name ?? null
    : null;

  const openSession = useCallback((id: string) => {
    setSelectedId(id);
    setView("chat");
  }, []);

  const openNewChat = useCallback((workspaceId: string | null) => {
    setNewChatWorkspaceId(workspaceId);
    setView("new-chat");
  }, []);
  const openNewWorkspace = useCallback(() => setView("new-workspace"), []);

  // ⌘K / Ctrl+K opens the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        ws={ws}
        view={view}
        selectedSessionId={selectedId}
        onSelectSession={openSession}
        onNavigate={setView}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenSettings={() => setView("settings")}
        onNewChat={openNewChat}
        onNewWorkspace={openNewWorkspace}
      />
      <main className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        {view === "chat" && (
          <ChatView session={session} controller={controller} workspaceName={workspaceName} />
        )}
        {view === "settings" && <SettingsPage onBack={() => setView("chat")} />}
        {view === "new-chat" && (
          <NewChatScreen
            ws={ws}
            initialWorkspaceId={newChatWorkspaceId}
            onCreated={openSession}
            onNewWorkspace={openNewWorkspace}
          />
        )}
        {view === "new-workspace" && (
          <NewProjectScreen
            onCancel={() => setView("chat")}
            onCreated={(id) => {
              setNewChatWorkspaceId(id);
              setView("new-chat");
            }}
          />
        )}
      </main>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        ws={ws}
        onSelectSession={openSession}
      />
    </div>
  );
}
