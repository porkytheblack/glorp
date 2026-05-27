import React, { useEffect, useRef, useState, useCallback } from "react";
import { theme } from "../theme.ts";
import type { ChatTurn, DisplaySlotEvent, OrchestratorPhase } from "../../shared/events.ts";
import { MessageRow, StreamingRow } from "./message.tsx";
import { InlineSlot } from "./inline-slot.tsx";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface Props {
  turns: ChatTurn[];
  streamingText: string;
  width: number;
  height: number;
  busy: boolean;
  activeSubagents: string[];
  compacting: boolean;
  loopPhase: OrchestratorPhase | null;
  foregroundAgent: string | null;
  showReasoning?: boolean;
  pendingSlots: DisplaySlotEvent[];
  scrollDelta: number;
  onScrollConsumed: () => void;
}

export function Transcript({
  turns, streamingText, width, height, busy, activeSubagents,
  loopPhase, foregroundAgent, showReasoning, pendingSlots,
  scrollDelta, onScrollConsumed,
}: Props) {
  const scrollboxRef = useRef<{
    scrollTo?: (p: number | { x: number; y: number }) => void;
    scrollHeight?: number;
    scrollTop?: number;
  } | null>(null);
  const [pinned, setPinned] = useState(true);
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setSpinnerFrame((f) => (f + 1) % SPINNER.length), 90);
    return () => clearInterval(t);
  }, [busy]);

  // Handle keyboard scroll deltas from parent
  useEffect(() => {
    if (scrollDelta === 0) return;
    const sb = scrollboxRef.current;
    if (!sb) { onScrollConsumed(); return; }
    const currentTop = sb.scrollTop ?? 0;
    const scrollAmount = scrollDelta * 3;
    const newTop = Math.max(0, currentTop + scrollAmount);
    try {
      if (typeof sb.scrollTo === "function") {
        sb.scrollTo({ x: 0, y: newTop });
      } else if (typeof sb.scrollTop === "number") {
        sb.scrollTop = newTop;
      }
    } catch { /* tolerant of API drift */ }
    setPinned(false);
    onScrollConsumed();
  }, [scrollDelta, onScrollConsumed]);

  // Auto-scroll to bottom when pinned
  useEffect(() => {
    if (!pinned) return;
    const sb = scrollboxRef.current;
    if (!sb) return;
    const target = (sb.scrollHeight ?? 100_000) + 1000;
    try {
      if (typeof sb.scrollTo === "function") {
        sb.scrollTo({ x: 0, y: target });
      } else if (typeof sb.scrollTop === "number") {
        sb.scrollTop = target;
      }
    } catch { /* tolerant */ }
  }, [turns, streamingText, busy, height, pinned, pendingSlots.length]);

  // Re-pin when new content arrives while not scrolling
  useEffect(() => { setPinned(true); }, [turns.length, busy]);

  const showThinking = busy && !streamingText;
  const permissionSlots = pendingSlots.filter((s) => s.isPermissionRequest);

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
        {turns.map((t) => (
          <MessageRow key={t.id} turn={t} showReasoning={showReasoning} />
        ))}
        {streamingText && <StreamingRow text={streamingText} />}
        {permissionSlots.map((slot) => (
          <InlineSlot key={slot.slotId} slot={slot} width={width} />
        ))}
        {showThinking && (
          <ThinkingRow
            frame={SPINNER[spinnerFrame]!}
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
  generating: "generating", evaluating: "evaluating", checkpoint: "at checkpoint",
};

function ThinkingRow({ frame, activeSubagents, loopPhase, foregroundAgent }: {
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
  const color = phaseText ? theme.loopActive : theme.warning;
  return (
    <box flexDirection="row" marginBottom={1}>
      <box width={6} marginRight={1}>
        <text fg={color}><strong>{frame}</strong></text>
      </box>
      <box flexDirection="column" flexGrow={1}>
        <text fg={color}>{label}</text>
        <text fg={theme.textDim}>ctrl-c to interrupt</text>
      </box>
    </box>
  );
}
