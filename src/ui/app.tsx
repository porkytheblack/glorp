import React, { useCallback, useEffect, useState } from "react";
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
import { PermissionsList } from "./permissions-list.tsx";
import { getSlotRenderer, UnknownSlot } from "./slot-renderers/index.tsx";
import { EmptyHero } from "./empty-hero.tsx";
import { GLORP_VERSION } from "../shared/version.ts";
import type { GlorpHandle } from "../agent/glorp.ts";
import type { DisplaySlotEvent } from "../shared/events.ts";
import type { SlotRenderer } from "./slot-renderers/registry.tsx";

const MIN_SIDEBAR = 26;
const MAX_SIDEBAR = 40;
const NARROW_THRESHOLD = 90;

type Overlay = null | "model" | "session" | "transmissions" | "permissions";

function isAbortKey(key: { name?: string; sequence?: string; ctrl?: boolean }): boolean {
  return key.sequence === "\u0003" || (key.ctrl === true && key.name === "c");
}

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

  useEffect(() => glorp.onLabelChange(setModelLabel), [glorp]);

  useEffect(() => {
    setModelLabel(glorp.modelLabel);
    void glorp.hydrateUi();
  }, [glorp]);

  const handleInputHeightChange = useCallback((next: number) => {
    setInputHeight((current) => (current === next ? current : next));
  }, []);

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
    if (key.name === "escape" && state.busy) {
      glorp.abort();
    }
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
          onSwapSession(null);
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
        onSubmit={(text) => {
          void glorp.send(text);
        }}
        onAbort={() => glorp.abort()}
        onQuit={onQuit}
      />
    );
  }

  const sidebarVisible = width >= NARROW_THRESHOLD;
  const sidebarWidth = Math.max(
    MIN_SIDEBAR,
    Math.min(MAX_SIDEBAR, Math.floor(width * 0.28)),
  );
  const mainWidth = sidebarVisible ? width - sidebarWidth : width;
  const statusH = 1;
  const inputH = Math.min(Math.max(4, inputHeight), Math.max(4, height - 2));
  const footerH = 1;
  const transcriptH = Math.max(1, height - statusH - inputH - footerH);

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
            busy={state.busy}
            activeSubagents={state.activeSubagents}
            compacting={state.compacting}
          />
        </box>
        {sidebarVisible && <Sidebar state={state} width={sidebarWidth} />}
      </box>
      <box flexDirection="column" width={width}>
        <InputBar
          busy={state.busy}
          width={width}
          modelLabel={modelLabel}
          slashCommands={glorp.extensions.slash}
          skillHints={glorp.extensions.skills}
          subagentMentions={glorp.extensions.mentions}
          onSubmit={(text) => {
            void glorp.send(text);
          }}
          onAbort={() => glorp.abort()}
          onQuit={onQuit}
          onHeightChange={handleInputHeightChange}
        />
      </box>
      <box flexDirection="row" justifyContent="space-between" width={width} paddingX={1}>
        <text fg={theme.textDim}>{truncatePath(workspace, Math.floor(width / 2) - 4)}</text>
        <text fg={theme.textDim}>v{GLORP_VERSION}</text>
      </box>
    </box>
  );
}

function DisplaySlotHost({
  glorp,
  slot,
  Renderer,
}: {
  glorp: GlorpHandle;
  slot: DisplaySlotEvent;
  Renderer: SlotRenderer;
}) {
  const [closed, setClosed] = useState(false);
  const close = useCallback((fn: () => void) => {
    setClosed((wasClosed) => {
      if (wasClosed) return wasClosed;
      fn();
      return true;
    });
  }, []);

  useKeyboard((key) => {
    if (closed) return;
    if (isAbortKey(key)) {
      close(() => {
        glorp.rejectSlot(slot.slotId, "cancelled");
        glorp.abort();
      });
      return;
    }
    if (key.name === "escape") {
      close(() => glorp.rejectSlot(slot.slotId, "cancelled"));
    }
  });

  return React.createElement(Renderer, {
    slot,
    onResolve: (value: unknown) => close(() => glorp.resolveSlot(slot.slotId, value)),
    onReject: (reason?: string) => close(() => glorp.rejectSlot(slot.slotId, reason ?? "cancelled")),
  });
}

function truncatePath(p: string, max = 38): string {
  if (p.length <= max) return p;
  const parts = p.split("/");
  if (parts.length <= 2) return "…" + p.slice(-(max - 1));
  return ".../" + parts.slice(-2).join("/");
}
