import React from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { theme } from "../theme.ts";
import { OverlayHost, OverlayPanel } from "../overlay-host.tsx";
import type { SlotRendererProps } from "./registry.tsx";

/**
 * Permission request slot renderer. In the TUI, permissions render inline
 * in the transcript (via InlineSlot). This full-screen version is the
 * fallback for non-permission display slots that use the permission_request
 * renderer name. Resolves with `true` (allow) or `false` (deny).
 */
export function PermissionSlot({ slot, onResolve, onReject }: SlotRendererProps) {
  const { width, height } = useTerminalDimensions();
  const input = slot.input as { toolName?: string; toolInput?: unknown };
  const toolName = input.toolName ?? "(unknown)";
  const preview = prettyInput(input.toolInput);
  const previewLines = preview.split("\n").slice(0, 10);

  useKeyboard((key) => {
    if (key.name === "y" || key.name === "a" || key.name === "return") onResolve(true);
    else if (key.name === "n" || key.name === "d") onResolve(false);
    else if (key.name === "escape") onReject("cancelled");
  });

  const panelW = Math.min(86, Math.max(56, width - 8));

  return (
    <OverlayHost width={width} height={height}>
      <OverlayPanel
        title="permission requested"
        titleColor={theme.warning}
        borderColor={theme.warning}
        width={panelW}
      >
        <text fg={theme.text}>
          glorp wants to call <span fg={theme.toolName}>{toolName}</span>
        </text>
        <box marginTop={1} flexDirection="column">
          {previewLines.map((line, i) => (
            <text key={i} fg={theme.toolOutput}>{`  ${line.slice(0, panelW - 6)}`}</text>
          ))}
        </box>
        <box marginTop={1}>
          <text fg={theme.textMuted}>
            <span fg={theme.success}>y/a/enter</span> allow always{" · "}
            <span fg={theme.error}>n/d</span> deny always{" · "}
            <span fg={theme.error}>esc</span> cancel
          </text>
        </box>
        <text fg={theme.textDim}>choice is remembered. revoke later with Ctrl+P.</text>
      </OverlayPanel>
    </OverlayHost>
  );
}

function prettyInput(input: unknown): string {
  if (input == null) return "(no input)";
  if (typeof input === "string") return input;
  try { return JSON.stringify(input, null, 2); }
  catch { return String(input); }
}
