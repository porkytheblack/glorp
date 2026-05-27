import React from "react";
import type { DisplaySlotEvent } from "../../shared/events.ts";
import { theme } from "../theme.ts";

interface Props {
  slot: DisplaySlotEvent;
  width: number;
}

/**
 * Renders a permission prompt INSIDE the transcript scroll area rather than
 * as a full-screen overlay. Bordered box with: tool name, command preview,
 * and y/n/Esc keybindings. The parent handles keyboard — this is display only.
 */
export function InlineSlot({ slot, width }: Props) {
  const input = slot.input as { toolName?: string; toolInput?: unknown; message?: string };
  const toolName = input.toolName ?? slot.renderer;
  const preview = formatPreview(input.toolInput ?? input.message);
  const previewLines = preview.split("\n").slice(0, 6);
  const boxW = Math.min(width - 4, 80);

  return (
    <box flexDirection="column" marginBottom={1} marginLeft={7}>
      <box
        flexDirection="column"
        width={boxW}
        border
        borderStyle="rounded"
        borderColor={theme.warning}
        backgroundColor={theme.bgPanel}
        paddingX={1}
      >
        <box flexDirection="row">
          <text fg={theme.warning}><strong>permission </strong></text>
          <text fg={theme.toolName}>{toolName}</text>
        </box>
        {previewLines.length > 0 && (
          <box flexDirection="column" marginTop={0}>
            {previewLines.map((line, i) => (
              <text key={i} fg={theme.toolOutput}>
                {clip(line, boxW - 4)}
              </text>
            ))}
          </box>
        )}
        <box flexDirection="row" marginTop={0}>
          <text fg={theme.textMuted}>
            <span fg={theme.success}>y</span> allow
            <span fg={theme.textDim}> · </span>
            <span fg={theme.error}>n</span> deny
            <span fg={theme.textDim}> · </span>
            <span fg={theme.error}>esc</span> cancel
          </text>
        </box>
      </box>
    </box>
  );
}

function formatPreview(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  try { return JSON.stringify(input, null, 2); }
  catch { return String(input); }
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
