import React, { useEffect, useRef } from "react";
import { theme, BANNER } from "../theme.ts";
import { GLORP_VERSION, GLORP_CODENAME } from "../../shared/version.ts";
import type { ChatTurn } from "../../shared/events.ts";
import { MessageRow, StreamingRow } from "./message.tsx";

export function Transcript({
  turns,
  streamingText,
  width,
  height,
  workspace,
}: {
  turns: ChatTurn[];
  streamingText: string;
  width: number;
  height: number;
  workspace: string;
}) {
  const scrollboxRef = useRef<any>(null);
  // Auto-scroll to bottom whenever turns or streaming text change.
  useEffect(() => {
    const sb = scrollboxRef.current;
    if (sb && typeof sb.scrollToBottom === "function") {
      sb.scrollToBottom();
    }
  }, [turns.length, streamingText, height]);

  const empty = turns.length === 0;
  return (
    <scrollbox
      ref={scrollboxRef}
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
              <span fg={theme.accent}>glorp</span> — your friendly extraterrestrial coding pal.
            </text>
            <text fg={theme.textMuted}>
              type a request, or try{" "}
              <span fg={theme.accent}>/help</span>,{" "}
              <span fg={theme.accent}>/plan</span>, or{" "}
              <span fg={theme.accent}>@researcher</span> &lt;question&gt;.
            </text>
            <text> </text>
          </box>
        )}
        {turns.map((t) => (
          <MessageRow key={t.id} turn={t} />
        ))}
        {streamingText && <StreamingRow text={streamingText} />}
      </box>
    </scrollbox>
  );
}
