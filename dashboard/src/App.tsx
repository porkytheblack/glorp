/**
 * Three-column shell: project sidebar | chat | environment panel. Session
 * state is owned here (one live WebSocket via useSession) and shared with the
 * chat + environment columns, so the event stream drives both.
 */

import { useState } from "react";
import { useSessions } from "./state/useSessions.ts";
import { useSession } from "./state/useSession.ts";
import { Sidebar } from "./components/Sidebar.tsx";
import { ChatPanel } from "./components/ChatPanel.tsx";
import { EnvironmentPanel } from "./components/EnvironmentPanel.tsx";
import { SettingsDrawer } from "./components/SettingsDrawer.tsx";

export function App() {
  const { sessions, refresh } = useSessions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const controller = useSession(selectedId);
  const selected = sessions.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="grid h-full grid-cols-[260px_1fr_320px] overflow-hidden">
      <Sidebar
        sessions={sessions}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreated={(id) => {
          setSelectedId(id);
          refresh();
        }}
      />
      <ChatPanel
        session={selected}
        controller={controller}
        onOpenSettings={selected ? () => setSettingsOpen(true) : undefined}
      />
      <EnvironmentPanel session={selected} state={controller.state} />
      {selected && (
        <SettingsDrawer
          sessionId={selected.id}
          session={selected}
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
