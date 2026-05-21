import React, { useEffect, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { GlorpStore } from "../agent/store.ts";
import { theme } from "./theme.ts";

// Tools that can request permission today. The list is hardcoded — keep
// it in sync with the `requiresPermission: true` markers in src/agent/tools/.
const GATED_TOOLS = ["bash", "edit", "write", "dispatch_fleet"];

interface Props {
  store: GlorpStore;
  onClearPermission: (toolName: string) => Promise<void>;
  onClose: () => void;
}

type Status = "granted" | "denied" | "unset";

/**
 * Ctrl+P overlay. Lists every gated tool and the current persistent
 * permission state. Press 'r' to revoke (set to unset → next call will
 * re-prompt).
 */
export function PermissionsList({ store, onClearPermission, onClose }: Props) {
  const { width, height } = useTerminalDimensions();
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [cursor, setCursor] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Record<string, Status> = {};
      for (const name of GATED_TOOLS) {
        out[name] = await store.getPermission(name);
      }
      if (!cancelled) setStatuses(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [store, tick]);

  useKeyboard((key) => {
    if (key.name === "escape") return onClose();
    if (key.name === "up" || key.name === "k") {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.name === "down" || key.name === "j") {
      setCursor((c) => Math.min(GATED_TOOLS.length - 1, c + 1));
      return;
    }
    if (key.name === "r") {
      const name = GATED_TOOLS[cursor];
      if (!name) return;
      void onClearPermission(name).then(() => setTick((t) => t + 1));
    }
  });

  const panelW = Math.min(70, Math.max(50, width - 8));
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
        borderColor={theme.borderActive}
        backgroundColor={theme.bgPanel}
        padding={1}
      >
        <text fg={theme.accent}>
          <strong>permissions</strong>
        </text>
        <text fg={theme.textDim}>↑↓ pick · r revoke · esc close</text>
        <box marginTop={1} flexDirection="column">
          {GATED_TOOLS.map((name, i) => {
            const status = statuses[name] ?? "unset";
            const highlighted = i === cursor;
            const fg = highlighted ? theme.bg : statusColor(status);
            const bg = highlighted ? statusColor(status) : "transparent";
            return (
              <text key={name} fg={fg} bg={bg}>{` ${statusGlyph(status)} ${name.padEnd(20, " ")}  ${status.padEnd(8, " ")} `}</text>
            );
          })}
        </box>
        <box marginTop={1}>
          <text fg={theme.textMuted}>
            "granted" = always allow · "denied" = always block · "unset" = re-prompt next call
          </text>
        </box>
      </box>
    </box>
  );
}

function statusColor(s: Status): string {
  switch (s) {
    case "granted":
      return theme.success;
    case "denied":
      return theme.error;
    case "unset":
      return theme.textMuted;
  }
}

function statusGlyph(s: Status): string {
  switch (s) {
    case "granted":
      return "✓";
    case "denied":
      return "✗";
    case "unset":
      return "○";
  }
}
