import React from "react";
import { theme } from "../theme.ts";

export interface SlashCommand {
  name: string;
  description: string;
}

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

export function SlashMenu({
  query,
  selectedIndex,
  width,
  slashCommands = SLASH_COMMANDS,
  subagentMentions = SUBAGENT_MENTIONS,
}: {
  query: string;
  selectedIndex: number;
  width: number;
  slashCommands?: SlashCommand[];
  subagentMentions?: SlashCommand[];
}) {
  const isSlash = query.startsWith("/");
  const isMention = query.startsWith("@");
  if (!isSlash && !isMention) return null;
  const pool = isSlash ? slashCommands : subagentMentions;
  const matches = pool.filter((c) => c.name.startsWith(query));
  if (matches.length === 0) return null;
  const headerLabel = isSlash ? "slash commands" : "subagents";
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
        {headerLabel} · {matches.length} match{matches.length === 1 ? "" : "es"} ·{" "}
        <span fg={theme.accent}>tab</span> to complete
      </text>
      {matches.slice(0, 8).map((c, i) => (
        <box key={c.name} flexDirection="row">
          <text
            fg={i === selectedIndex ? theme.bg : theme.accent}
            bg={i === selectedIndex ? theme.accent : "transparent"}
          >
            {" "}
            {c.name.padEnd(16, " ")}{" "}
          </text>
          <text fg={theme.textMuted}> {c.description}</text>
        </box>
      ))}
    </box>
  );
}
