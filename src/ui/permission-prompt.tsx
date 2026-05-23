import React from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { PermissionRequest } from "../shared/events.ts";
import { theme } from "./theme.ts";

interface Props {
  request: PermissionRequest;
  onResolve: (allow: boolean) => void;
  onReject?: (reason?: string) => void;
}

/**
 * Modal overlay shown when a tool with `requiresPermission: true` is about
 * to run and the user hasn't previously granted/denied it. Decision is
 * persistent — Glove writes "granted" / "denied" to the store. The user
 * can revoke later via the Ctrl+P permissions list.
 *
 *   y / a   — allow (remembers)
 *   n / d   — deny (remembers)
 *   esc     — cancel
 */
export function PermissionPrompt({ request, onResolve, onReject }: Props) {
  const { width, height } = useTerminalDimensions();

  useKeyboard((key) => {
    if (key.name === "y" || key.name === "a" || key.name === "return") onResolve(true);
    else if (key.name === "n" || key.name === "d") onResolve(false);
    else if (key.name === "escape") onReject?.("cancelled");
  });

  const panelW = Math.min(96, Math.max(60, width - 8));
  const inputPretty = prettyInput(request.toolInput);
  const inputLines = inputPretty.split("\n").slice(0, 12);
  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={theme.bg}
      justifyContent="center"
      alignItems="center"
    >
      <box
        flexDirection="column"
        width={panelW}
        border
        borderStyle="rounded"
        borderColor={theme.warning}
        backgroundColor={theme.bgPanel}
        padding={1}
      >
        <text fg={theme.warning}>
          <strong>permission requested</strong>
        </text>
        <text fg={theme.text}>
          glorp wants to call <span fg={theme.toolName}>{request.toolName}</span>
        </text>
        <box marginTop={1} flexDirection="column">
          {inputLines.map((line, i) => (
            <text key={i} fg={theme.toolOutput}>{`  ${line.slice(0, panelW - 6)}`}</text>
          ))}
          {inputPretty.split("\n").length > inputLines.length && (
            <text fg={theme.textDim}>
              {`  … +${inputPretty.split("\n").length - inputLines.length} more lines`}
            </text>
          )}
        </box>
        <box marginTop={1} flexDirection="row">
          <text fg={theme.textMuted}>
            <span fg={theme.success}>y/a/enter</span> allow always   <span fg={theme.error}>n/d</span> deny always   <span fg={theme.error}>esc</span> cancel
          </text>
        </box>
        <text fg={theme.textDim}>your choice is remembered. revoke later with Ctrl+P.</text>
      </box>
    </box>
  );
}

function prettyInput(input: unknown): string {
  if (input == null) return "(no input)";
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}
