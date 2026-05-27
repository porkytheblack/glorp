import React, { useMemo, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { theme } from "./theme.ts";
import { OverlayHost, OverlayPanel } from "./overlay-host.tsx";
import type { UiState } from "./store-reducer.ts";

type Severity = "low" | "medium" | "high";

interface Props {
  transmissions: UiState["transmissions"];
  onClose: () => void;
}

const GLYPHS: Record<Severity, string> = { low: "◇", medium: "◈", high: "◆" };
const COLORS: Record<Severity, string> = {
  low: theme.textMuted, medium: theme.transmission, high: theme.transmissionHigh,
};

export function TransmissionsLog({ transmissions, onClose }: Props) {
  const { width, height } = useTerminalDimensions();
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState<Severity | null>(null);

  const visible = useMemo(() => {
    const filtered = filter
      ? transmissions.filter((e) =>
          filter === "medium" ? e.severity !== "low" : e.severity === filter)
      : transmissions;
    return [...filtered].reverse();
  }, [transmissions, filter]);

  const clamped = Math.min(cursor, Math.max(0, visible.length - 1));

  useKeyboard((key) => {
    if (key.name === "escape") return onClose();
    if (key.name === "up" || key.name === "k") {
      setCursor((c) => Math.max(0, c - 1)); return;
    }
    if (key.name === "down" || key.name === "j") {
      setCursor((c) => Math.min(Math.max(0, visible.length - 1), c + 1)); return;
    }
    if (key.name === "1") { setFilter("low"); setCursor(0); return; }
    if (key.name === "2") { setFilter("medium"); setCursor(0); return; }
    if (key.name === "3") { setFilter("high"); setCursor(0); return; }
    if (key.name === "0") { setFilter(null); setCursor(0); return; }
    if (key.name === "c") {
      const e = visible[clamped];
      if (e) copyToClipboard(e.payload);
    }
  });

  const panelW = Math.min(100, Math.max(56, width - 6));
  const filterLabel = filter
    ? ` · filter: ${filter === "medium" ? "med+" : filter}` : "";

  return (
    <OverlayHost width={width} height={height}>
      <OverlayPanel
        title="signals log"
        titleColor={theme.transmission}
        hint={`up/down · 1 low · 2 med+ · 3 high · 0 clear · c copy · esc close`}
        borderColor={theme.transmission}
        width={panelW}
      >
        <text fg={theme.textMuted}>
          {visible.length}/{transmissions.length} entries{filterLabel}
        </text>
        <box flexDirection="column" marginTop={1}>
          {visible.length === 0 && (
            <text fg={theme.textMuted}>
              {transmissions.length === 0 ? "no signals yet." : "no entries match filter."}
            </text>
          )}
          {visible.slice(0, Math.max(5, height - 12)).map((e, i) => {
            const highlighted = i === clamped;
            const fg = highlighted ? theme.bg : COLORS[e.severity];
            const bg = highlighted ? COLORS[e.severity] : "transparent";
            const glyph = GLYPHS[e.severity];
            const ago = relativeMs(e.at);
            const head = `${glyph} ${e.payload}`;
            return (
              <text key={`${e.at}-${i}`} fg={fg} bg={bg}>
                {` ${clip(head, panelW - 16)}${ago.padStart(12, " ")} `}
              </text>
            );
          })}
        </box>
      </OverlayPanel>
    </OverlayHost>
  );
}

function relativeMs(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function copyToClipboard(text: string): void {
  const b64 = Buffer.from(text, "utf-8").toString("base64");
  process.stdout.write(`\x1b]52;c;${b64}\x07`);
}
