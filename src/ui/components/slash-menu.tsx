import React from "react";
import { theme } from "../theme.ts";

export interface SlashCommand {
  name: string;
  description: string;
}

export const SLASH_MENU_VISIBLE_ROWS = 8;

/**
 * Static fallback used if no `extensions` catalogue is supplied (tests,
 * smoke harness). Real runs pass the catalogue from `glorp.extensions`
 * so the menu always reflects what's actually registered.
 */
export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/plan", description: "switch to plan-first mode for this turn" },
  { name: "/diff", description: "list files changed since last user message" },
  { name: "/compact", description: "force a context compaction now" },
  { name: "/clear", description: "compact and reset the working slate" },
  { name: "/concise", description: "ask glorp to be terser" },
  { name: "/transmissions", description: "ask about the homeworld-comms panel" },
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
  query,
  selectedIndex,
  width,
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
  const clampedSelectedIndex = Math.max(0, Math.min(selectedIndex, Math.max(0, matches.length - 1)));
  const firstVisibleIndex = Math.min(
    Math.max(0, clampedSelectedIndex - SLASH_MENU_VISIBLE_ROWS + 1),
    Math.max(0, matches.length - SLASH_MENU_VISIBLE_ROWS),
  );
  const visibleMatches = matches.slice(firstVisibleIndex, firstVisibleIndex + SLASH_MENU_VISIBLE_ROWS);
  const rangeHint =
    matches.length > SLASH_MENU_VISIBLE_ROWS
      ? ` · showing ${firstVisibleIndex + 1}-${firstVisibleIndex + visibleMatches.length}`
      : "";

  return (
    <box
      flexDirection="column"
      width={width}
      border
      borderColor={theme.borderActive}
      backgroundColor={theme.bgPanel}
      padding={1}
    >
      <text fg={theme.textDim}>
        {headerLabel} · {matches.length} match{matches.length === 1 ? "" : "es"}{rangeHint} ·{" "}
        <span fg={theme.accent}>tab</span> {triggerHint}
      </text>
      {matches.length === 0 ? (
        <box flexDirection="row">
          <text fg={theme.textMuted}> no matching {headerLabel}</text>
        </box>
      ) : (
        visibleMatches.map((c, i) => {
          const absoluteIndex = firstVisibleIndex + i;
          const selected = absoluteIndex === clampedSelectedIndex;
          return (
            <box key={c.name} flexDirection="row">
              <text fg={selected ? theme.bg : theme.accent} bg={selected ? theme.accent : "transparent"}>
                {" "}
                {c.name.padEnd(16, " ")}{" "}
              </text>
              <text fg={theme.textMuted}> {c.description}</text>
            </box>
          );
        })
      )}
    </box>
  );
}
