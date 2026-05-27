import React, { useCallback, useEffect, useState } from "react";
import { useTerminalDimensions, useKeyboard } from "@opentui/react";
import { theme } from "./theme.ts";
import { useUiState } from "./store.ts";
import { Transcript } from "./components/transcript.tsx";
import { Sidebar, SIDEBAR_STRIP_WIDTH } from "./components/sidebar.tsx";
import { StatusBar } from "./components/status-bar.tsx";
import { InputBar } from "./components/input-bar.tsx";
import { ModelSwitcher } from "./model-switcher.tsx";
import { SessionPicker } from "./session-picker.tsx";
import { TransmissionsLog } from "./transmissions-log.tsx";
import { PermissionsList } from "./permissions-list.tsx";
import { getSlotRenderer, UnknownSlot } from "./slot-renderers/index.tsx";
import { EmptyHero } from "./empty-hero.tsx";
import { DisplaySlotHost, isAbortKey } from "./slot-host.tsx";
import { AgentRunner, hasRunnerContent } from "./components/agent-runner.tsx";
import { GLORP_VERSION } from "../shared/version.ts";
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
  onSwapSession?: (sessionId: string | null) => void;
  dataDir: string;
}) {
  const { width, height } = useTerminalDimensions();
  const state = useUiState();
  const [modelLabel, setModelLabel] = useState(glorp.modelLabel);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [inputHeight, setInputHeight] = useState(4);
  const [showReasoning, setShowReasoning] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [runnerOpen, setRunnerOpen] = useState(false);

  useEffect(() => {
    setModelLabel(glorp.modelLabel);
    void glorp.hydrateUi();
    return glorp.onLabelChange(setModelLabel);
  }, [glorp]);

  const handleInputHeightChange = useCallback((n: number) => setInputHeight((c) => c === n ? c : n), []);

  useKeyboard((key) => {
    if (state.busy && isAbortKey(key)) {
      glorp.abort();
      return;
    }
    if (overlay) return; // overlay owns the keyboard until it closes
    if (key.name === "m" && key.ctrl) return setOverlay("model");
    if (key.name === "s" && key.ctrl && onSwapSession) return setOverlay("session");
    if (key.name === "t" && key.ctrl) return setOverlay("transmissions");
    if (key.name === "p" && key.ctrl) return setOverlay("permissions");
    if (key.name === "r" && key.ctrl) return setShowReasoning((v) => !v);
    if (key.name === "a" && key.ctrl) return setRunnerOpen((v) => !v);
    if (key.name === "b" && key.ctrl) return setSidebarOpen((v) => !v);
    if (key.name === "escape" && state.busy) glorp.abort();
  });

  const pendingSlot = state.displaySlots[0];
  if (pendingSlot) {
    const Renderer = getSlotRenderer(pendingSlot.renderer) ?? UnknownSlot;
    return <DisplaySlotHost glorp={glorp} slot={pendingSlot} Renderer={Renderer} />;
  }

  if (overlay === "model") {
    return (
      <ModelSwitcher
        credentials={glorp.credentials}
        catalog={glorp.catalog}
        projectConfig={glorp.projectConfig}
        activeProfileId={glorp.credentials.getActiveProfile()?.id}
        onPick={async (profileId) => {
          setOverlay(null);
          try { await glorp.swapProfile(profileId); } catch {}
        }}
        onClose={() => setOverlay(null)}
      />
    );
  }

  if (overlay === "session" && onSwapSession) {
    return (
      <SessionPicker
        dataDir={dataDir}
        workspace={workspace}
        variant="overlay"
        activeSessionId={glorp.sessionId}
        onPick={(sessionId) => {
          setOverlay(null);
          if (sessionId !== glorp.sessionId) onSwapSession(sessionId);
        }}
        onNew={() => { setOverlay(null); onSwapSession(null); }}
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
        onClearAllForTool={(name) => glorp.clearPermission(name)}
        onClearKey={(key) => glorp.clearPermissionKey(key)}
        onClose={() => setOverlay(null)}
      />
    );
  }

  if (state.turns.length === 0 && !state.streamingText) {
    return (
      <EmptyHero
        width={width}
        height={height}
        modelLabel={modelLabel}
        workspace={workspace}
        busy={state.busy}
        slashCommands={glorp.extensions.slash}
        skillHints={glorp.extensions.skills}
        subagentMentions={glorp.extensions.mentions}
        onSubmit={(text) => { void glorp.send(text); }}
        onAbort={() => glorp.abort()}
        onQuit={onQuit}
      />
    );
  }

  const sidebarFits = width >= NARROW_THRESHOLD;
  const sidebarW = sidebarOpen ? Math.max(MIN_SIDEBAR, Math.min(MAX_SIDEBAR, Math.floor(width * 0.28))) : SIDEBAR_STRIP_WIDTH;
  const mainWidth = sidebarFits ? width - sidebarW : width;
  const statusH = 1;
  const inputH = Math.min(Math.max(4, inputHeight), Math.max(4, height - 2));
  const runnerH = hasRunnerContent(state) ? (runnerOpen ? 2 : 1) : 0;
  const footerH = 1;
  const transcriptH = Math.max(1, height - statusH - inputH - runnerH - footerH);

  return (
    <box flexDirection="column" width={width} height={height} backgroundColor={theme.bg}>
      <StatusBar state={state} workspace={workspace} model={modelLabel} showReasoning={showReasoning} />
      <box flexDirection="row" flexGrow={1}>
        <box flexDirection="column" width={mainWidth} height={transcriptH}>
          <Transcript
            turns={state.turns}
            streamingText={state.streamingText}
            width={mainWidth}
            height={transcriptH}
            workspace={workspace}
            busy={state.busy}
            activeSubagents={state.activeSubagents}
            compacting={state.compacting}
            loopPhase={state.loopPhase}
            foregroundAgent={state.foregroundAgent}
            showReasoning={showReasoning}
          />
        </box>
        {sidebarFits && <Sidebar state={state} width={sidebarW} collapsed={!sidebarOpen} />}
      </box>
      <box flexDirection="column" width={width}>
        <InputBar
          busy={state.busy}
          width={width}
          modelLabel={modelLabel}
          slashCommands={glorp.extensions.slash}
          skillHints={glorp.extensions.skills}
          subagentMentions={glorp.extensions.mentions}
          onSubmit={(text) => { void glorp.send(text); }}
          onAbort={() => glorp.abort()}
          onQuit={onQuit}
          onHeightChange={handleInputHeightChange}
        />
      </box>
      {runnerH > 0 && <AgentRunner state={state} width={width} collapsed={!runnerOpen} />}
      <box flexDirection="row" justifyContent="space-between" width={width} paddingX={1}>
        <text fg={theme.textDim}>{truncatePath(workspace, Math.floor(width / 2) - 4)}</text>
        <text fg={theme.textDim}>v{GLORP_VERSION}</text>
      </box>
    </box>
  );
}

function truncatePath(p: string, max = 38): string {
  if (p.length <= max) return p;
  return p.split("/").length <= 2 ? "…" + p.slice(-(max - 1)) : ".../" + p.split("/").slice(-2).join("/");
}
