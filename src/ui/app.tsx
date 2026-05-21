import React, { useEffect, useState } from "react";
import * as path from "node:path";
import * as os from "node:os";
import { useTerminalDimensions, useKeyboard } from "@opentui/react";
import { theme } from "./theme.ts";
import { useUiState } from "./store.ts";
import { Transcript } from "./components/transcript.tsx";
import { Sidebar } from "./components/sidebar.tsx";
import { StatusBar } from "./components/status-bar.tsx";
import { InputBar } from "./components/input-bar.tsx";
import { ModelSwitcher } from "./model-switcher.tsx";
import { SessionPicker } from "./session-picker.tsx";
import { TransmissionsLog } from "./transmissions-log.tsx";
import { PermissionPrompt } from "./permission-prompt.tsx";
import { PermissionsList } from "./permissions-list.tsx";
import type { GlorpHandle } from "../agent/glorp.ts";

const MIN_SIDEBAR = 26;
const MAX_SIDEBAR = 40;
const NARROW_THRESHOLD = 90;

type Overlay = null | "model" | "session" | "transmissions" | "permissions";

export function App({
  glorp,
  workspace,
  onQuit,
  onSwapSession,
  dataDir,
}: {
  glorp: GlorpHandle;
  workspace: string;
  onQuit: () => void;
  /** Asks the parent (cli.ts) to tear down + rebuild glorp with a new session id. */
  onSwapSession?: (sessionId: string | null) => void;
  dataDir: string;
}) {
  const { width, height } = useTerminalDimensions();
  const state = useUiState();
  const [modelLabel, setModelLabel] = useState(glorp.modelLabel);
  const [overlay, setOverlay] = useState<Overlay>(null);

  // Subscribe to model-label changes (driven by swapProfile).
  useEffect(() => glorp.onLabelChange(setModelLabel), [glorp]);

  // Whenever the glorp instance is swapped (post-session-switch), reset
  // our tracked label from the new instance's modelLabel.
  useEffect(() => {
    setModelLabel(glorp.modelLabel);
  }, [glorp]);

  useKeyboard((key) => {
    if (overlay) return; // overlay owns the keyboard until it closes
    if (key.name === "m" && key.ctrl) return setOverlay("model");
    if (key.name === "s" && key.ctrl && onSwapSession) return setOverlay("session");
    if (key.name === "t" && key.ctrl) return setOverlay("transmissions");
    if (key.name === "p" && key.ctrl) return setOverlay("permissions");
    if (key.name === "escape" && state.busy) {
      glorp.abort();
    }
  });

  // ---- Modal overlays --------------------------------------------------
  // Permission prompts always win (the agent is blocked waiting on them).
  const pendingPermission = state.permissionRequests[0];
  if (pendingPermission) {
    return (
      <PermissionPrompt
        request={pendingPermission}
        onResolve={(allow) => glorp.resolvePermission(pendingPermission.slotId, allow)}
      />
    );
  }

  if (overlay === "model") {
    return (
      <ModelSwitcher
        credentials={glorp.credentials}
        activeProfileId={glorp.credentials.getActiveProfile()?.id}
        onPick={async (profileId) => {
          setOverlay(null);
          try {
            await glorp.swapProfile(profileId);
          } catch {}
        }}
        onClose={() => setOverlay(null)}
      />
    );
  }

  if (overlay === "session" && onSwapSession) {
    return (
      <SessionPicker
        dataDir={dataDir}
        variant="overlay"
        activeSessionId={glorp.sessionId}
        onPick={(sessionId) => {
          setOverlay(null);
          if (sessionId !== glorp.sessionId) onSwapSession(sessionId);
        }}
        onNew={() => {
          setOverlay(null);
          onSwapSession(null); // null = caller picks a fresh id
        }}
        onClose={() => setOverlay(null)}
      />
    );
  }

  if (overlay === "transmissions") {
    return <TransmissionsLog dataDir={dataDir} onClose={() => setOverlay(null)} />;
  }

  if (overlay === "permissions") {
    return (
      <PermissionsList
        store={glorp.store}
        onClearPermission={(name) => glorp.clearPermission(name)}
        onClose={() => setOverlay(null)}
      />
    );
  }

  // ---- Main app --------------------------------------------------------
  const sidebarVisible = width >= NARROW_THRESHOLD;
  const sidebarWidth = Math.max(
    MIN_SIDEBAR,
    Math.min(MAX_SIDEBAR, Math.floor(width * 0.28)),
  );
  const mainWidth = sidebarVisible ? width - sidebarWidth : width;
  const statusH = 1;
  const inputH = 5; // border 2 + content 3
  const transcriptH = Math.max(1, height - statusH - inputH);

  return (
    <box flexDirection="column" width={width} height={height} backgroundColor={theme.bg}>
      <StatusBar state={state} workspace={workspace} model={modelLabel} />
      <box flexDirection="row" flexGrow={1}>
        <box flexDirection="column" width={mainWidth} height={transcriptH}>
          <Transcript
            turns={state.turns}
            streamingText={state.streamingText}
            width={mainWidth}
            height={transcriptH}
            workspace={workspace}
          />
        </box>
        {sidebarVisible && <Sidebar state={state} width={sidebarWidth} />}
      </box>
      <box flexDirection="column" width={width}>
        <InputBar
          busy={state.busy}
          width={width}
          onSubmit={(text) => {
            void glorp.send(text);
          }}
          onAbort={() => glorp.abort()}
          onQuit={onQuit}
        />
      </box>
    </box>
  );
}
