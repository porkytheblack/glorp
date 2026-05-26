import React, { useEffect, useRef, useState } from "react";
import { theme, BANNER } from "../theme.ts";
import { GLORP_VERSION, GLORP_CODENAME } from "../../shared/version.ts";
import type { ChatTurn, OrchestratorPhase } from "../../shared/events.ts";
import { MessageRow, StreamingRow } from "./message.tsx";

interface Props {
  turns: ChatTurn[];
  streamingText: string;
  width: number;
  height: number;
  workspace: string;
  busy: boolean;
  activeSubagents: string[];
  compacting: boolean;
  loopPhase: OrchestratorPhase | null;
  foregroundAgent: string | null;
  showReasoning?: boolean;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Transcript({
  turns,
  streamingText,
  width,
  height,
  workspace,
  busy,
  activeSubagents,
  loopPhase,
  foregroundAgent,
  showReasoning,
}: Props) {
  // Cast loosely because the OpenTUI scrollbox ref shape is renderable-
  // specific and we only touch `scrollTo` / `scrollHeight`.
  const scrollboxRef = useRef<{
    scrollTo?: (p: number | { x: number; y: number }) => void;
    scrollHeight?: number;
    scrollTop?: number;
  } | null>(null);

  // OpenTUI's ScrollBox doesn't expose `scrollToBottom()` — we set
  // `scrollTop = scrollHeight` (the renderable clamps if it overshoots)
  // or fall back to `scrollTo({ y: scrollHeight })`. The effect fires on
  // any change that could grow the content: new turns, new streaming
  // chars, finished tool calls (turns are mutated in place), and even
  // height changes (so a resize re-pins to bottom).
  useEffect(() => {
    const sb = scrollboxRef.current;
    if (!sb) return;
    const target = (sb.scrollHeight ?? 100_000) + 1000;
    try {
      if (typeof sb.scrollTo === "function") {
        sb.scrollTo({ x: 0, y: target });
      } else if (typeof sb.scrollTop === "number") {
        sb.scrollTop = target;
      }
    } catch {
      /* tolerant of API drift */
    }
  }, [turns, streamingText, busy, height, activeSubagents.length]);

  // Animated spinner used by the "thinking" row. Lives at this level so
  // it only ticks when the row is visible.
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length), 90);
    return () => clearInterval(t);
  }, [busy]);

  const showThinking = busy && !streamingText; // streaming row covers the busy state itself
  const empty = turns.length === 0;
  return (
    <scrollbox
      ref={scrollboxRef as React.MutableRefObject<any>}
      width={width}
      height={height}
      focused={false}
      style={{
        rootOptions: { backgroundColor: theme.bg },
        viewportOptions: { backgroundColor: theme.bg },
        contentOptions: { backgroundColor: theme.bg },
        scrollbarOptions: {
          showArrows: false,
          trackOptions: { foregroundColor: theme.borderActive, backgroundColor: theme.border },
        },
      }}
    >
      <box flexDirection="column" padding={1}>
        {empty && (
          <box flexDirection="column" marginBottom={1}>
            {BANNER.map((line, i) => (
              <text key={i} fg={theme.accent}>
                {line}
              </text>
            ))}
            <text fg={theme.textMuted}>
              v{GLORP_VERSION} "{GLORP_CODENAME}" · workspace {workspace}
            </text>
            <text> </text>
            <text fg={theme.text}>
              <span fg={theme.accent}>glorp</span> coding workspace.
            </text>
            <text fg={theme.textMuted}>
              type a request, or try <span fg={theme.accent}>/help</span>,{" "}
              <span fg={theme.accent}>/plan</span>, or{" "}
              <span fg={theme.accent}>@researcher</span> &lt;question&gt;.
            </text>
            <text> </text>
          </box>
        )}
        {turns.map((t) => (
          <MessageRow key={t.id} turn={t} showReasoning={showReasoning} />
        ))}
        {streamingText && <StreamingRow text={streamingText} />}
        {showThinking && (
          <ThinkingRow
            frame={SPINNER_FRAMES[spinnerFrame]!}
            activeSubagents={activeSubagents}
            loopPhase={loopPhase}
            foregroundAgent={foregroundAgent}
          />
        )}
      </box>
    </scrollbox>
  );
}

const PHASE_LABEL: Partial<Record<OrchestratorPhase, string>> = {
  generating: "generating",
  evaluating: "evaluating",
  checkpoint: "at checkpoint",
};

function ThinkingRow({
  frame,
  activeSubagents,
  loopPhase,
  foregroundAgent,
}: {
  frame: string;
  activeSubagents: string[];
  loopPhase: OrchestratorPhase | null;
  foregroundAgent: string | null;
}) {
  const phaseText = loopPhase ? PHASE_LABEL[loopPhase] : null;
  let label: string;
  if (phaseText && foregroundAgent) {
    label = `${foregroundAgent} ${phaseText}…`;
  } else if (phaseText) {
    label = `orchestrator ${phaseText}…`;
  } else if (activeSubagents.length > 0) {
    label = `${activeSubagents.map((n) => `@${n}`).join(", ")} working…`;
  } else {
    label = "glorp is thinking…";
  }
  return (
    <box flexDirection="row" marginBottom={1}>
      <box width={6} marginRight={1}>
        <text fg={phaseText ? theme.loopActive : theme.warning}>
          <strong>{frame}</strong>
        </text>
      </box>
      <box flexDirection="column" flexGrow={1}>
        <text fg={phaseText ? theme.loopActive : theme.warning}>{label}</text>
        <text fg={theme.textDim}>press ctrl-c to interrupt · esc also aborts</text>
      </box>
    </box>
  );
}
