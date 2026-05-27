import React from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { theme } from "./theme.ts";
import { KEYBINDS } from "./keybinds.ts";
import { OverlayHost, OverlayPanel } from "./overlay-host.tsx";

interface Props {
  onClose: () => void;
}

export function HelpDialog({ onClose }: Props) {
  const { width, height } = useTerminalDimensions();

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "return" || key.name === "space") {
      onClose();
    }
  });

  const panelW = Math.min(72, Math.max(50, width - 8));

  const globalBinds = KEYBINDS.filter((kb) => kb.context === "global");
  const inputBinds = KEYBINDS.filter((kb) => kb.context === "input");
  const permBinds = KEYBINDS.filter((kb) => kb.context === "permission");
  const overlayBinds = KEYBINDS.filter((kb) => kb.context === "overlay");

  return (
    <OverlayHost width={width} height={height}>
      <OverlayPanel
        title="keyboard shortcuts"
        hint="press esc / enter / space to close"
        width={panelW}
      >
        <box marginTop={1} flexDirection="column">
          <Section title="Global" binds={globalBinds} panelW={panelW} />
          <Section title="Input" binds={inputBinds} panelW={panelW} />
          <Section title="Permission Prompts" binds={permBinds} panelW={panelW} />
          <Section title="Overlays" binds={overlayBinds} panelW={panelW} />
        </box>
      </OverlayPanel>
    </OverlayHost>
  );
}

function Section({ title, binds, panelW }: {
  title: string;
  binds: Array<{ label: string; description: string }>;
  panelW: number;
}) {
  if (binds.length === 0) return null;
  const descW = Math.max(20, panelW - 16);
  return (
    <box flexDirection="column" marginBottom={1}>
      <text fg={theme.accent}><strong>{title}</strong></text>
      {binds.map((kb) => (
        <box key={`${kb.label}-${kb.description}`} flexDirection="row">
          <text fg={theme.text}>{` ${kb.label.padEnd(10, " ")}`}</text>
          <text fg={theme.textMuted}>{clip(kb.description, descW)}</text>
        </box>
      ))}
    </box>
  );
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
