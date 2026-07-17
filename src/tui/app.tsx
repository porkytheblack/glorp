import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTerminalDimensions, useKeyboard } from "@opentui/react";
import { theme } from "./theme.ts";
import { nextPermissionMode } from "../agent/runtime/permission-mode.ts";
import { useUiState } from "./store.ts";
import { Transcript } from "./components/transcript.tsx";
import { ContextRail } from "./components/context-rail.tsx";
import { StatusBar } from "./components/status-bar.tsx";
import { ChromeBar } from "./components/chrome-bar.tsx";
import { InputBar } from "./components/input-bar.tsx";
import { ModelSwitcher } from "./model-switcher.tsx";
import { SessionPicker } from "./session-picker.tsx";
import { TransmissionsLog } from "./transmissions-log.tsx";
import { PermissionsList } from "./permissions-list.tsx";
import { HelpDialog } from "./help-dialog.tsx";
import { AgentManager } from "./agent-manager.tsx";
import { McpPanel } from "./mcp-panel.tsx";
import { CommandPalette, type PaletteCommand } from "./command-palette.tsx";
import { getSlotRenderer, UnknownSlot } from "./slot-renderers/index.tsx";
import { EmptyHero } from "./empty-hero.tsx";
import type { GlorpClient, ClientState } from "../client/client.ts";

const NARROW = 90;
const MEDIUM = 140;
const WIDE = 200;

type Overlay = null | "model" | "session" | "transmissions" | "permissions" | "help" | "agents" | "palette" | "mcp";

const QUICK_ADD_ROLES = ["researcher", "reviewer", "planner", "builder"] as const;

export function App({
  client,
  workspace,
  onQuit,
  onSwapSession,
}: {
  client: GlorpClient;
  workspace: string;
  onQuit: () => void;
  onSwapSession?: (sessionId: string | null) => void;
}) {
  const { width, height } = useTerminalDimensions();
  const state = useUiState(client);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [inputHeight, setInputHeight] = useState(4);
  const [showReasoning, setShowReasoning] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [scrollDelta, setScrollDelta] = useState(0);
  const [connState, setConnState] = useState<ClientState>(client.state);

  useEffect(() => {
    return client.onStateChange(setConnState);
  }, [client]);

  const handleInputHeight = useCallback((n: number) => {
    setInputHeight((c) => c === n ? c : n);
  }, []);

  const onScrollConsumed = useCallback(() => setScrollDelta(0), []);

  useKeyboard((key) => {
    // Abort handling always active
    if (isAbortKey(key) && state.busy) { client.abort(); return; }
    // Permission slot keyboard — intercept y/n for inline permission prompts
    const permSlot = state.displaySlots.find((s) => s.isPermissionRequest);
    if (permSlot && !overlay) {
      if (key.name === "y" || key.name === "a") {
        client.resolvePermission(permSlot.slotId, true); return;
      }
      if (key.name === "n" || key.name === "d") {
        client.resolvePermission(permSlot.slotId, false); return;
      }
      if (key.name === "escape") {
        client.rejectSlot(permSlot.slotId, "cancelled"); return;
      }
    }
    // Overlay owns keyboard when open
    if (overlay) return;
    // Non-permission display slot keyboard
    const nonPermSlot = state.displaySlots.find((s) => !s.isPermissionRequest);
    if (nonPermSlot) return; // let the slot renderer handle it
    // Global shortcuts
    if (key.name === "k" && key.ctrl) { setOverlay("palette"); return; }
    if (key.name === "a" && key.ctrl) { setOverlay("agents"); return; }
    if (key.name === "m" && key.ctrl) { setOverlay("model"); return; }
    if (key.name === "s" && key.ctrl && onSwapSession) { setOverlay("session"); return; }
    if (key.name === "t" && key.ctrl) { setOverlay("transmissions"); return; }
    if (key.name === "e" && key.ctrl) { setOverlay("mcp"); return; }
    if (key.name === "p" && key.ctrl) { setOverlay("permissions"); return; }
    if (key.name === "y" && key.ctrl) { client.setPermissionMode(nextPermissionMode(state.permissionMode)); return; }
    if (key.name === "r" && key.ctrl) { setShowReasoning((v) => !v); return; }
    if (key.name === "b" && key.ctrl) { setRailOpen((v) => !v); return; }
    if ((key.sequence === "\x1f" || (key.name === "/" && key.ctrl)) || key.name === "?" && key.ctrl) {
      setOverlay("help"); return;
    }
    // Keyboard scrolling
    if (key.name === "up" && key.ctrl) { setScrollDelta((d) => d - 5); return; }
    if (key.name === "down" && key.ctrl) { setScrollDelta((d) => d + 5); return; }
    // Escape
    if (key.name === "escape" && state.busy) { client.abort(); return; }
  });

  const commands = useMemo<PaletteCommand[]>(() => {
    const cmds: PaletteCommand[] = [
      { id: "agents", label: "Manage agents", detail: "^A", group: "Agents", icon: "◇", keywords: ["switch", "roster"], run: () => setOverlay("agents") },
    ];
    for (const a of state.agents) {
      if (a.id === state.activeAgentId) continue;
      cmds.push({ id: `switch:${a.id}`, label: `Switch to ${a.label}`, detail: a.role, group: "Agents", icon: "▸", keywords: ["agent", a.role], run: () => client.switchAgent(a.id) });
    }
    for (const role of QUICK_ADD_ROLES) {
      cmds.push({ id: `add:${role}`, label: `Add ${role} agent`, group: "Agents", icon: "+", keywords: ["new", "spawn"], run: () => client.addAgent(role) });
    }
    cmds.push(
      { id: "mcp", label: "MCP servers", detail: "^E", group: "MCP", icon: "⌁", keywords: ["mcp", "tools", "connect"], run: () => setOverlay("mcp") },
    );
    for (const s of state.mcpServers) {
      cmds.push({
        id: `mcp:${s.id}`,
        label: `${s.active ? "Disconnect" : "Connect"} ${s.name}`,
        detail: s.state === "connected" ? `${s.toolCount} tools` : s.state,
        group: "MCP", icon: s.state === "connected" ? "●" : "○",
        keywords: ["mcp", s.id, ...(s.tags ?? [])],
        run: () => client.setMcpServer(s.id, !s.active),
      });
    }
    cmds.push(
      { id: "model", label: "Switch model", detail: "^M", group: "Model", icon: "◈", run: () => setOverlay("model") },
      { id: "perm-mode", label: `Permission mode: ${state.permissionMode} → ${nextPermissionMode(state.permissionMode)}`, detail: "^Y", group: "Permissions", icon: "⚑", keywords: ["auto", "bypass", "normal"], run: () => client.setPermissionMode(nextPermissionMode(state.permissionMode)) },
      { id: "perms", label: "Manage permissions", detail: "^P", group: "Permissions", icon: "○", run: () => setOverlay("permissions") },
      { id: "rail", label: `${railOpen ? "Hide" : "Show"} context rail`, detail: "^B", group: "View", icon: "▤", run: () => setRailOpen((v) => !v) },
      { id: "reasoning", label: `${showReasoning ? "Hide" : "Show"} reasoning`, detail: "^R", group: "View", icon: "✦", run: () => setShowReasoning((v) => !v) },
      { id: "transmissions", label: "Transmissions log", detail: "^T", group: "View", icon: "≋", run: () => setOverlay("transmissions") },
      { id: "help", label: "Help & keybindings", group: "System", icon: "?", run: () => setOverlay("help") },
      { id: "quit", label: "Quit glorp", group: "System", icon: "⏻", run: () => onQuit() },
    );
    if (onSwapSession) {
      cmds.push(
        { id: "session", label: "Switch session", detail: "^S", group: "Session", icon: "❒", run: () => setOverlay("session") },
        { id: "new-session", label: "New session", group: "Session", icon: "✚", keywords: ["fresh", "blank"], run: () => onSwapSession(null) },
      );
    }
    return cmds;
  }, [state.agents, state.activeAgentId, state.mcpServers, state.permissionMode, railOpen, showReasoning, client, onSwapSession, onQuit]);

  // Bare slash commands that act on the TUI itself instead of going to the
  // agent (e.g. `/mcp` opens the MCP panel). Returns true when handled.
  const handleLocalCommand = useCallback((cmd: string): boolean => {
    switch (cmd) {
      case "/mcp": setOverlay("mcp"); return true;
      case "/model": setOverlay("model"); return true;
      case "/agents": setOverlay("agents"); return true;
      case "/permissions": setOverlay("permissions"); return true;
      case "/transmissions": setOverlay("transmissions"); return true;
      case "/sessions": case "/resume":
        if (onSwapSession) { setOverlay("session"); return true; }
        return false;
      default: return false;
    }
  }, [onSwapSession]);

  // Non-permission display slots render as full-screen overlays
  const nonPermSlot = state.displaySlots.find((s) => !s.isPermissionRequest);
  if (nonPermSlot) {
    const Renderer = getSlotRenderer(nonPermSlot.renderer) ?? UnknownSlot;
    return React.createElement(Renderer, {
      slot: nonPermSlot,
      onResolve: (v: unknown) => client.resolveSlot(nonPermSlot.slotId, v),
      onReject: (r?: string) => client.rejectSlot(nonPermSlot.slotId, r ?? "cancelled"),
    });
  }

  // Overlay rendering
  if (overlay === "palette") {
    return <CommandPalette commands={commands} onClose={() => setOverlay(null)} />;
  }
  if (overlay === "model") {
    return (
      <ModelSwitcher client={client}
        activeProfileId={undefined}
        onPick={(id) => { setOverlay(null); client.swapProfile(id); }}
        onClose={() => setOverlay(null)} />
    );
  }
  if (overlay === "session" && onSwapSession) {
    return (
      <SessionPicker client={client} workspace={workspace}
        activeSessionId={client.currentSessionId ?? undefined}
        onPick={(id) => { setOverlay(null); if (id !== client.currentSessionId) onSwapSession(id); }}
        onNew={() => { setOverlay(null); onSwapSession(null); }}
        onClose={() => setOverlay(null)} />
    );
  }
  if (overlay === "transmissions") {
    return <TransmissionsLog transmissions={state.transmissions} onClose={() => setOverlay(null)} />;
  }
  if (overlay === "permissions") {
    return <PermissionsList client={client} onClose={() => setOverlay(null)} />;
  }
  if (overlay === "help") {
    return <HelpDialog onClose={() => setOverlay(null)} />;
  }
  if (overlay === "agents") {
    return <AgentManager client={client} state={state} onClose={() => setOverlay(null)} />;
  }
  if (overlay === "mcp") {
    return <McpPanel client={client} state={state} onClose={() => setOverlay(null)} />;
  }

  // Empty state
  if (state.turns.length === 0 && !state.streamingText) {
    return (
      <EmptyHero width={width} height={height}
        modelLabel={state.modelLabel} workspace={workspace} busy={state.busy}
        onSubmit={(t: string) => client.send(t)}
        onLocalCommand={handleLocalCommand}
        onAbort={() => client.abort()} onQuit={onQuit} />
    );
  }

  // Layout computation
  const railFits = width >= NARROW;
  const railW = !railFits || !railOpen ? 0
    : width >= WIDE ? 32 : width >= MEDIUM ? 28 : 20;
  const mainW = width - railW;
  const statusH = 1;
  const chromeH = 1;
  const inputH = Math.min(Math.max(4, inputHeight), Math.max(4, height - 4));
  const transcriptH = Math.max(1, height - statusH - inputH - chromeH);

  return (
    <box flexDirection="column" width={width} height={height} backgroundColor={theme.bg}>
      <StatusBar state={state} workspace={workspace} connectionState={connState} />
      <box flexDirection="row" flexGrow={1}>
        <box flexDirection="column" width={mainW} height={transcriptH}>
          <Transcript
            turns={state.turns} streamingText={state.streamingText}
            width={mainW} height={transcriptH} busy={state.busy}
            activeSubagents={state.activeSubagents} compacting={state.compacting}
            loopPhase={state.loopPhase} foregroundAgent={state.foregroundAgent}
            showReasoning={showReasoning}
            pendingSlots={state.displaySlots.filter((s) => s.isPermissionRequest)}
            scrollDelta={scrollDelta} onScrollConsumed={onScrollConsumed}
          />
        </box>
        {railW > 0 && <ContextRail state={state} width={railW} />}
      </box>
      <InputBar busy={state.busy} width={width}
        modelLabel={state.modelLabel}
        onSubmit={(t, imgs) => client.send(t, imgs)}
        onLocalCommand={handleLocalCommand}
        onAbort={() => client.abort()} onQuit={onQuit}
        onHeightChange={handleInputHeight} />
      <ChromeBar modelLabel={state.modelLabel}
        contextPct={state.stats.contextPct}
        peerCount={state.peerCount} width={width}
        permissionMode={state.permissionMode} />
    </box>
  );
}

function isAbortKey(key: { sequence?: string; ctrl?: boolean; name?: string }): boolean {
  return key.sequence === "" || (key.ctrl === true && key.name === "c");
}
