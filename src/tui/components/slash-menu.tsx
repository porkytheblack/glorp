import React from "react";
import { theme } from "../theme.ts";

export interface SlashCommand {
  name: string;
  description: string;
}

export const SLASH_MENU_VISIBLE_ROWS = 8;

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/build", description: "plan then build a feature (orchestrated)" },
  { name: "/plan", description: "switch to plan-first mode for this turn" },
  { name: "/diff", description: "list files changed since last user message" },
  { name: "/compact", description: "force a context compaction now" },
  { name: "/clear", description: "clear and reset the working slate" },
  { name: "/concise", description: "ask glorp to be terser" },
  { name: "/transmissions", description: "open the signals log" },
  { name: "/help", description: "show commands" },
  { name: "/quit", description: "exit glorp" },
];

export const SUBAGENT_MENTIONS: SlashCommand[] = [
  { name: "@planner", description: "design an approach without writing code" },
  { name: "@researcher", description: "investigate the codebase or web" },
  { name: "@reviewer", description: "review a recent change for issues" },
];

export const SKILL_HINTS: SlashCommand[] = [
  { name: "$concise", description: "trim verbosity for this exchange" },
];

export function SlashMenu({
  query, selectedIndex, width,
  slashCommands = SLASH_COMMANDS,
  skillHints = SKILL_HINTS,
  subagentMentions = SUBAGENT_MENTIONS,
}: {
  query: string;
  selectedIndex: number;
  width: number;
  slashCommands?: SlashCommand[];
  skillHints?: SlashCommand[];
  subagentMentions?: SlashCommand[];
}) {
  const isSlash = query.startsWith("/");
  const isSkill = query.startsWith("$");
  const isMention = query.startsWith("@");
  if (!isSlash && !isSkill && !isMention) return null;
  const pool = isSlash ? slashCommands : isSkill ? skillHints : subagentMentions;
  const matches = pool.filter((c) => c.name.startsWith(query));
  const headerLabel = isSlash ? "slash commands" : isSkill ? "skills" : "subagents";
  const triggerHint = isSkill ? "to complete as /skill" : "to complete";
  const clamped = Math.max(0, Math.min(selectedIndex, Math.max(0, matches.length - 1)));
  const firstVisible = Math.min(
    Math.max(0, clamped - SLASH_MENU_VISIBLE_ROWS + 1),
    Math.max(0, matches.length - SLASH_MENU_VISIBLE_ROWS),
  );
  const visible = matches.slice(firstVisible, firstVisible + SLASH_MENU_VISIBLE_ROWS);
  const rangeHint = matches.length > SLASH_MENU_VISIBLE_ROWS
    ? ` · showing ${firstVisible + 1}-${firstVisible + visible.length}` : "";

  return (
    <box flexDirection="column" width={width} border borderColor={theme.borderActive}
      backgroundColor={theme.bgPanel} padding={1}>
      <text fg={theme.textDim}>
        {headerLabel} · {matches.length} match{matches.length === 1 ? "" : "es"}{rangeHint} ·{" "}
        <span fg={theme.accent}>tab</span> {triggerHint}
      </text>
      {matches.length === 0 ? (
        <text fg={theme.textMuted}> no matching {headerLabel}</text>
      ) : (
        visible.map((c, i) => {
          const absIdx = firstVisible + i;
          const sel = absIdx === clamped;
          return (
            <box key={c.name} flexDirection="row">
              <text fg={sel ? theme.bg : theme.accent} bg={sel ? theme.accent : "transparent"}>
                {" "}{c.name.padEnd(16, " ")}{" "}
              </text>
              <text fg={theme.textMuted}> {c.description}</text>
            </box>
          );
        })
      )}
    </box>
  );
}
