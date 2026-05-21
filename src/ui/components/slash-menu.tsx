import React from "react";
import { theme } from "../theme.ts";

interface SlashCommand {
  name: string;
  description: string;
}

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

export const SUBAGENT_MENTIONS = [
  { name: "@planner", description: "design an approach without writing code" },
  { name: "@researcher", description: "investigate the codebase or web" },
  { name: "@reviewer", description: "review a recent change for issues" },
];

export function SlashMenu({
  query,
  selectedIndex,
  width,
}: {
  query: string;
  selectedIndex: number;
  width: number;
}) {
  const isSlash = query.startsWith("/");
  const isMention = query.startsWith("@");
  if (!isSlash && !isMention) return null;
  const pool = isSlash ? SLASH_COMMANDS : SUBAGENT_MENTIONS;
  const matches = pool.filter((c) => c.name.startsWith(query));
  if (matches.length === 0) return null;
  return (
    <box
      flexDirection="column"
      width={width}
      border
      borderColor={theme.borderActive}
      backgroundColor={theme.bgPanel}
      padding={1}
    >
      {matches.slice(0, 6).map((c, i) => (
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
