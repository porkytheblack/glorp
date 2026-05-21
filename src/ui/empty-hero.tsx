import React from "react";
import { theme } from "./theme.ts";
import { InputBar } from "./components/input-bar.tsx";
import type { SlashCommand } from "./components/slash-menu.tsx";

interface Props {
  width: number;
  height: number;
  modelLabel: string;
  workspace: string;
  busy: boolean;
  onSubmit: (text: string) => void;
  onAbort: () => void;
  onQuit: () => void;
  slashCommands?: SlashCommand[];
  subagentMentions?: SlashCommand[];
}

/**
 * Pre-chat landing screen. The brand sits in the dead-centre of the
 * viewport with the input pinned just below it. Once the user sends a
 * message (so `turns.length > 0`) the App switches to the regular chat
 * layout where the input lives at the bottom and the transcript fills
 * above.
 *
 * Layout shape, top to bottom inside a vertically-centred column:
 *   • ASCII brand          (shade font, dim)
 *   • input bar            (compact width, model + hints inside)
 *   • subtle hint line     ("tab agents · ctrl+m models · …")
 */
export function EmptyHero({
  width,
  height,
  modelLabel,
  workspace,
  busy,
  onSubmit,
  onAbort,
  onQuit,
  slashCommands,
  subagentMentions,
}: Props) {
  // Compact input: 60-80% of viewport width, capped so it doesn't sprawl
  // on ultra-wide terminals.
  const inputWidth = Math.min(96, Math.max(40, Math.floor(width * 0.7)));
  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={theme.bg}
      justifyContent="center"
      alignItems="center"
    >
      <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
        <box marginBottom={2} alignItems="center">
          <ascii-font text="glorp" font="shade" color={theme.textDim} />
        </box>
        <box width={inputWidth} flexDirection="column">
          <InputBar
            busy={busy}
            width={inputWidth}
            modelLabel={modelLabel}
            variant="hero"
            slashCommands={slashCommands}
            subagentMentions={subagentMentions}
            onSubmit={onSubmit}
            onAbort={onAbort}
            onQuit={onQuit}
          />
        </box>
      </box>
      <box flexDirection="row" justifyContent="space-between" width={width} paddingX={1}>
        <text fg={theme.textDim}>{truncate(workspace, Math.floor(width / 2) - 4)}</text>
        <text fg={theme.textDim}>{"v0.1.0"}</text>
      </box>
    </box>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const parts = s.split("/");
  if (parts.length <= 2) return "…" + s.slice(-(max - 1));
  return ".../" + parts.slice(-2).join("/");
}
