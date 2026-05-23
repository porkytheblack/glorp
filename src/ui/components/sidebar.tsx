import React, { useEffect, useMemo, useState } from "react";
import { theme } from "../theme.ts";
import type { UiState } from "../store.ts";

const TASK_GLYPH: Record<string, string> = {
  pending: "o",
  in_progress: ">",
  completed: "x",
};

const TASK_COLOR: Record<string, string> = {
  pending: theme.textMuted,
  in_progress: theme.warning,
  completed: theme.success,
};

const GLORP_FRAMES: Record<UiState["mood"], string[][]> = {
  idle: [
    ["  .-.  ", " (o o) ", " /|_|\\ ", "  / \\  "],
    ["   .-. ", "  (o o)", "  /|_|\\", "   / \\"],
    ["  .-.  ", " (o o) ", " /|_|\\ ", "  / \\  "],
    [" .-.   ", "(o o)  ", "/|_|\\  ", "/ \\    "],
  ],
  thinking: [
    ["  .-. ? ", " (o.o)  ", " /|_|\\  ", "  / \\   "],
    [" ? .-.  ", "  (o.o) ", "  /|_|\\ ", "   / \\  "],
  ],
  working: [
    ["  .-.  ", " (>.<) ", "</|_|\\", "  / \\  "],
    ["  .-.  ", " (>.<) ", " /|_|\\>", "  / \\  "],
  ],
  speaking: [
    ["  .-.  ", " (^o^) ", " /|_|\\ ", "  / \\  "],
    ["  .-.  ", " (^O^) ", " /|_|\\ ", "  / \\  "],
  ],
  glitched: [
    ["  .-.  ", " [x_x] ", " /|#|\\ ", "  //   "],
    [" .-.- ", " [#_x]", " //|#|", "  \\\\  "],
  ],
  error: [
    ["  .-.  ", " (x_x) ", " /|!|\\ ", "  / \\  "],
    ["  .-.  ", " (x.x) ", " /|!|\\ ", "  / \\  "],
  ],
};

function GlorpAvatar({ mood }: { mood: UiState["mood"] }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ms = mood === "idle" ? 420 : mood === "glitched" ? 120 : 220;
    const t = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [mood]);

  const frames = GLORP_FRAMES[mood] ?? GLORP_FRAMES.idle;
  const lines = frames[tick % frames.length]!;
  const color = mood === "glitched" ? theme.transmissionHigh : mood === "error" ? theme.error : theme.accent;
  return (
    <box flexDirection="column" alignItems="center" marginBottom={1}>
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
      return "awaiting";
    case "thinking":
      return "compacting / thinking";
    case "working":
      return "working";
    case "speaking":
      return "speaking";
    case "glitched":
      return "signal drift";
    case "error":
      return "errored";
  }
}

function Section({
  title,
  meta,
  color = theme.border,
  children,
}: {
  title: string;
  meta?: string;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <box flexDirection="column" border borderColor={color} padding={1} marginBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={color}>
          <strong>{title}</strong>
        </text>
        {meta && <text fg={theme.textMuted}>{meta}</text>}
      </box>
      <box height={1} />
      {children}
    </box>
  );
}

function wrapText(text: string, width: number, maxLines = 2): string[] {
  const target = Math.max(8, width);
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    if (word.length > target) {
      if (line) out.push(line);
      out.push(word.slice(0, target - 1) + "-");
      line = word.slice(target - 1);
    } else if (!line) {
      line = word;
    } else if (line.length + 1 + word.length <= target) {
      line += ` ${word}`;
    } else {
      out.push(line);
      line = word;
    }
    if (out.length >= maxLines) break;
  }
  if (line && out.length < maxLines) out.push(line);
  if (out.length === maxLines && words.join(" ").length > out.join(" ").length) {
    out[maxLines - 1] = `${out[maxLines - 1]!.slice(0, Math.max(0, target - 1))}~`;
  }
  return out.length ? out : [""];
}

function ProgressBar({ done, total, width }: { done: number; total: number; width: number }) {
  const slots = Math.max(4, Math.min(18, width));
  const filled = total > 0 ? Math.round((done / total) * slots) : 0;
  return (
    <text fg={theme.textMuted}>
      <span fg={theme.success}>{"#".repeat(filled)}</span>
      {"-".repeat(Math.max(0, slots - filled))}
    </text>
  );
}

export function Sidebar({ state, width }: { state: UiState; width: number }) {
  const pending = state.inbox.filter((i) => i.status === "pending");
  const resolved = state.inbox.filter((i) => i.status === "resolved");
  const taskCounts = useMemo(
    () => ({
      done: state.tasks.filter((t) => t.status === "completed").length,
      active: state.tasks.filter((t) => t.status === "in_progress").length,
      pending: state.tasks.filter((t) => t.status === "pending").length,
    }),
    [state.tasks],
  );
  const innerW = Math.max(16, width - 8);
  const latestTransmission = state.transmissions.at(-1);

  return (
    <box flexDirection="column" width={width} padding={1}>
      <GlorpAvatar mood={state.mood} />

      <Section title="status" meta={`${state.stats.contextPct}% ctx`} color={theme.accentSoft}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text}>turns</text>
          <text fg={theme.textMuted}>{state.stats.turns}</text>
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text}>tokens</text>
          <text fg={theme.textMuted}>{state.stats.tokens_in}</text>
        </box>
      </Section>

      <Section
        title="tasks"
        meta={`${taskCounts.done}/${state.tasks.length}`}
        color={state.tasks.some((t) => t.status === "in_progress") ? theme.warning : theme.border}
      >
        {state.tasks.length === 0 && <text fg={theme.textDim}>none yet</text>}
        {state.tasks.length > 0 && (
          <box marginBottom={1}>
            <ProgressBar done={taskCounts.done} total={state.tasks.length} width={innerW} />
          </box>
        )}
        {state.tasks.slice(0, 8).map((t) => (
          <box key={t.id} flexDirection="column" marginBottom={0}>
            {wrapText(t.status === "in_progress" ? t.activeForm : t.content, innerW - 2).map((line, i) => (
              <box key={i} flexDirection="row">
                <text fg={i === 0 ? TASK_COLOR[t.status] : theme.textDim}>
                  {i === 0 ? `${TASK_GLYPH[t.status]} ` : "  "}
                </text>
                <text fg={t.status === "completed" ? theme.textMuted : theme.text}>{line}</text>
              </box>
            ))}
          </box>
        ))}
        {state.tasks.length > 8 && <text fg={theme.textDim}>+{state.tasks.length - 8} more</text>}
      </Section>

      <Section title="inbox" meta={`${pending.length}p / ${resolved.length}r`}>
        {state.inbox.length === 0 && <text fg={theme.textDim}>empty</text>}
        {state.inbox.slice(-6).map((i) => (
          <box key={i.id} flexDirection="column">
            <text fg={i.status === "pending" ? theme.warning : theme.success}>
              {i.status === "pending" ? "o" : "x"} {i.tag.slice(0, innerW)}
            </text>
            {wrapText(i.response ?? i.request, innerW - 2, 1).map((line, idx) => (
              <text key={idx} fg={theme.textMuted}>  {line}</text>
            ))}
          </box>
        ))}
        {state.inbox.length > 6 && <text fg={theme.textDim}>+{state.inbox.length - 6} older</text>}
      </Section>

      <Section title="homeworld" meta={`${state.transmissions.length}`} color={theme.transmission}>
        {state.transmissions.length === 0 && <text fg={theme.textDim}>quiet</text>}
        {latestTransmission && (
          <box flexDirection="column">
            <text
              fg={
                latestTransmission.severity === "high"
                  ? theme.transmissionHigh
                  : latestTransmission.severity === "medium"
                    ? theme.transmission
                    : theme.textMuted
              }
            >
              signal: {latestTransmission.severity}
            </text>
            {wrapText(latestTransmission.payload, innerW, 3).map((line, i) => (
              <text key={i} fg={theme.textMuted}>{line}</text>
            ))}
          </box>
        )}
      </Section>

      {state.activeSubagents.length > 0 && (
        <Section title="subagents" meta="live" color={theme.warning}>
          {state.activeSubagents.map((n, i) => (
            <text key={i} fg={theme.warning}>
              {`> @${n}`}
            </text>
          ))}
        </Section>
      )}
    </box>
  );
}
