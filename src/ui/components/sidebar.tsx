import React from "react";
import { theme, GLORP_AVATARS } from "../theme.ts";
import type { UiState } from "../store.ts";

const TASK_GLYPH: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
};

const TASK_COLOR: Record<string, string> = {
  pending: theme.textMuted,
  in_progress: theme.warning,
  completed: theme.success,
};

function GlorpAvatar({ mood }: { mood: UiState["mood"] }) {
  const lines = GLORP_AVATARS[mood] ?? GLORP_AVATARS.idle;
  const color = mood === "glitched" ? theme.transmissionHigh : mood === "error" ? theme.error : theme.accent;
  return (
    <box flexDirection="column" alignItems="center">
      {lines.map((line, i) => (
        <text key={i} fg={color}>
          {line}
        </text>
      ))}
      <text fg={theme.textMuted}>{moodLabel(mood)}</text>
    </box>
  );
}

function moodLabel(mood: UiState["mood"]): string {
  switch (mood) {
    case "idle":
      return "  awaiting  ";
    case "thinking":
      return " thinking…  ";
    case "working":
      return "  working…  ";
    case "speaking":
      return "  speaking  ";
    case "glitched":
      return "  ▓ ▓ ▓ ▓  ";
    case "error":
      return "  errored   ";
  }
}

export function Sidebar({ state, width }: { state: UiState; width: number }) {
  const pending = state.inbox.filter((i) => i.status === "pending");
  const resolved = state.inbox.filter((i) => i.status === "resolved");
  return (
    <box flexDirection="column" width={width} padding={1} gap={1}>
      <GlorpAvatar mood={state.mood} />

      {/* Tasks */}
      <box flexDirection="column" border borderColor={theme.border} padding={1}>
        <text fg={theme.accent}>
          <strong>tasks</strong> ({state.tasks.length})
        </text>
        {state.tasks.length === 0 && (
          <text fg={theme.textDim}>none yet</text>
        )}
        {state.tasks.slice(0, 8).map((t) => (
          <box key={t.id} flexDirection="row">
            <text fg={TASK_COLOR[t.status]}>{TASK_GLYPH[t.status]} </text>
            <text fg={t.status === "completed" ? theme.textMuted : theme.text}>
              {(t.status === "in_progress" ? t.activeForm : t.content).slice(0, width - 6)}
            </text>
          </box>
        ))}
        {state.tasks.length > 8 && (
          <text fg={theme.textDim}>… +{state.tasks.length - 8} more</text>
        )}
      </box>

      {/* Inbox */}
      <box flexDirection="column" border borderColor={theme.border} padding={1}>
        <text fg={theme.accent}>
          <strong>inbox</strong>{" "}
          <span fg={theme.textMuted}>
            {pending.length}p · {resolved.length}r
          </span>
        </text>
        {state.inbox.length === 0 && <text fg={theme.textDim}>empty</text>}
        {state.inbox.slice(-6).map((i) => (
          <box key={i.id} flexDirection="column">
            <text fg={i.status === "pending" ? theme.warning : theme.success}>
              {i.status === "pending" ? "○" : "●"} {i.tag.slice(0, width - 6)}
            </text>
            <text fg={theme.textMuted}>  {(i.response ?? i.request).slice(0, width - 5)}</text>
          </box>
        ))}
        {state.inbox.length > 6 && (
          <text fg={theme.textDim}>… +{state.inbox.length - 6} older</text>
        )}
      </box>

      {/* Transmissions */}
      <box flexDirection="column" border borderColor={theme.transmission} padding={1}>
        <text fg={theme.transmission}>
          <strong>homeworld comms</strong>
        </text>
        {state.transmissions.length === 0 && (
          <text fg={theme.textDim}>quiet · /transmissions for context</text>
        )}
        {state.transmissions.slice(-5).map((t, i) => (
          <text
            key={i}
            fg={
              t.severity === "high"
                ? theme.transmissionHigh
                : t.severity === "medium"
                  ? theme.transmission
                  : theme.textMuted
            }
          >
            ◇ {t.payload.slice(0, width - 4)}
          </text>
        ))}
      </box>

      {/* Subagents */}
      {state.activeSubagents.length > 0 && (
        <box flexDirection="column" border borderColor={theme.warning} padding={1}>
          <text fg={theme.warning}>
            <strong>subagents · live</strong>
          </text>
          {state.activeSubagents.map((n, i) => (
            <text key={i} fg={theme.warning}>
              ▸ @{n}
            </text>
          ))}
        </box>
      )}
    </box>
  );
}
