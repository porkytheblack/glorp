/**
 * Center chat view (Codex-style). Composes the polished pieces: SessionTopBar,
 * the bubble-free MessageList, the rich Composer, the right SessionPanel, and a
 * SessionSettings popover. Core intent — only the user's request is bubbled
 * (subtly); agent text/tools/diffs render inline. The composer is centered on
 * the empty state and docks to the bottom once the chat has any turns.
 *
 * Contract is unchanged: exports `ChatView(props: ChatViewProps)` consumed by
 * AppShell, backed by the WS-driven SessionController.
 */

import { useState } from "react";
import type { SessionDto } from "../types.ts";
import type { SessionController } from "../state/useSession.ts";
import { MessageList } from "./MessageList.tsx";
import { Composer } from "./Composer.tsx";
import { SessionTopBar } from "./SessionTopBar.tsx";
import { SessionPanel } from "./SessionPanel.tsx";
import { SessionSettings } from "./SessionSettings.tsx";
import { AgentRoster } from "./AgentRoster.tsx";
import { Permissions } from "./Permissions.tsx";

export interface ChatViewProps {
  session: SessionDto | null;
  controller: SessionController;
  workspaceName: string | null;
}

export function ChatView(p: ChatViewProps) {
  const [panelOpen, setPanelOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [permsOpen, setPermsOpen] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const { state, send, abort, approve, deny } = p.controller;

  if (!p.session) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-glorp-muted">
        Select a chat from the sidebar, or create one{p.workspaceName ? ` in ${p.workspaceName}` : ""}.
      </div>
    );
  }
  const session: SessionDto = p.session;
  const empty = state.turns.length === 0 && !state.streamingText;

  const composer = (
    <Composer
      session={session}
      state={state}
      workspaceName={p.workspaceName}
      onSend={send}
      onAbort={abort}
      onOpenSettings={() => setSettingsOpen(true)}
    />
  );

  return (
    <div className="flex h-full min-h-0 min-w-0">
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <SessionTopBar
          session={session}
          state={state}
          workspaceName={p.workspaceName}
          panelOpen={panelOpen}
          showReasoning={showReasoning}
          onToggleReasoning={() => setShowReasoning((o) => !o)}
          onOpenAgents={() => setAgentsOpen(true)}
          onOpenPermissions={() => setPermsOpen(true)}
          onTogglePanel={() => setPanelOpen((o) => !o)}
          onOpenSettings={() => setSettingsOpen(true)}
          onAbort={abort}
          onDestroyed={() => {}}
        />

        {empty ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-6">
            <h1 className="text-center text-[26px] font-medium tracking-tight text-glorp-text">
              What should we build{p.workspaceName ? ` in ${p.workspaceName}` : ""}?
            </h1>
            <div className="w-full max-w-2xl">{composer}</div>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1">
              <MessageList state={state} showReasoning={showReasoning} onApprove={approve} onDeny={deny} />
            </div>
            <div className="shrink-0 border-t border-glorp-border px-4 py-3">
              <div className="mx-auto w-full max-w-3xl">{composer}</div>
            </div>
          </>
        )}
      </div>

      {panelOpen && <SessionPanel session={session} state={state} />}

      {settingsOpen && (
        <SessionSettings
          session={session}
          permissionMode={state.permissionMode}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {agentsOpen && <AgentRoster sessionId={session.id} onClose={() => setAgentsOpen(false)} />}
      {permsOpen && <Permissions sessionId={session.id} onClose={() => setPermsOpen(false)} />}
    </div>
  );
}
