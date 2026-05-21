import React, { useEffect } from "react";
import { useTerminalDimensions, useKeyboard } from "@opentui/react";
import { theme } from "./theme.ts";
import { useUiState } from "./store.ts";
import { Transcript } from "./components/transcript.tsx";
import { Sidebar } from "./components/sidebar.tsx";
import { StatusBar } from "./components/status-bar.tsx";
import { InputBar } from "./components/input-bar.tsx";
import type { GlorpHandle } from "../agent/glorp.ts";

const MIN_SIDEBAR = 26;
const MAX_SIDEBAR = 40;
const NARROW_THRESHOLD = 90;

export function App({
  glorp,
  workspace,
  model,
  onQuit,
}: {
  glorp: GlorpHandle;
  workspace: string;
  model: string;
  onQuit: () => void;
}) {
  const { width, height } = useTerminalDimensions();
  const state = useUiState();

  // Esc to abort current run.
  useKeyboard((key) => {
    if (key.name === "escape" && state.busy) {
      glorp.abort();
    }
  });

  const sidebarVisible = width >= NARROW_THRESHOLD;
  const sidebarWidth = Math.max(
    MIN_SIDEBAR,
    Math.min(MAX_SIDEBAR, Math.floor(width * 0.28)),
  );
  const mainWidth = sidebarVisible ? width - sidebarWidth : width;
  const statusH = 1;
  const inputH = 5; // border 2 + content 3
  const transcriptH = height - statusH - inputH;

  return (
    <box flexDirection="column" width={width} height={height} backgroundColor={theme.bg}>
      <StatusBar state={state} workspace={workspace} model={model} />
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
        {sidebarVisible && (
          <Sidebar state={state} width={sidebarWidth} />
        )}
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
