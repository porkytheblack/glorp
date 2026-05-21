import React, { useEffect, useMemo, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import * as fs from "node:fs";
import * as path from "node:path";
import { theme } from "./theme.ts";
import { relativeTime } from "../agent/sessions.ts";

interface TransmissionEntry {
  ts: string;
  subject: string;
  body: string;
  severity: "low" | "medium" | "high";
}

interface Props {
  dataDir: string;
  onClose: () => void;
}

const SEVERITY_GLYPHS: Record<TransmissionEntry["severity"], string> = {
  low: "◇",
  medium: "◈",
  high: "◆",
};

const SEVERITY_COLORS: Record<TransmissionEntry["severity"], string> = {
  low: theme.textMuted,
  medium: theme.transmission,
  high: theme.transmissionHigh,
};

/**
 * Ctrl+T overlay. Reads ~/.glorp/transmissions.jsonl (or whatever dataDir
 * is configured), parses each line as a TransmissionEntry, and renders a
 * scrollable, severity-filterable list. Most-recent-first.
 *
 *   ↑↓ scroll
 *   1   filter: low only
 *   2   filter: medium+
 *   3   filter: high only
 *   0   clear filter
 *   c   copy current entry to the clipboard (OSC 52)
 *   esc close
 */
export function TransmissionsLog({ dataDir, onClose }: Props) {
  const { width, height } = useTerminalDimensions();
  const [entries, setEntries] = useState<TransmissionEntry[]>([]);
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState<null | "low" | "medium" | "high">(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);

  useEffect(() => {
    setEntries(readEntries(dataDir));
  }, [dataDir]);

  const visible = useMemo(() => {
    const filtered = filter
      ? entries.filter((e) =>
          filter === "medium" ? e.severity !== "low" : e.severity === filter,
        )
      : entries;
    // Newest first.
    return [...filtered].reverse();
  }, [entries, filter]);

  const clamped = Math.min(cursor, Math.max(0, visible.length - 1));

  useKeyboard((key) => {
    if (key.name === "escape") return onClose();
    if (key.name === "up" || key.name === "k") {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.name === "down" || key.name === "j") {
      setCursor((c) => Math.min(Math.max(0, visible.length - 1), c + 1));
      return;
    }
    if (key.name === "1") {
      setFilter("low");
      setCursor(0);
      return;
    }
    if (key.name === "2") {
      setFilter("medium");
      setCursor(0);
      return;
    }
    if (key.name === "3") {
      setFilter("high");
      setCursor(0);
      return;
    }
    if (key.name === "0") {
      setFilter(null);
      setCursor(0);
      return;
    }
    if (key.name === "c") {
      const e = visible[clamped];
      if (!e) return;
      const text = `[${e.severity.toUpperCase()}] ${e.subject}\n${e.body}\n(${e.ts})`;
      copyToClipboard(text);
      setCopyHint("copied");
      setTimeout(() => setCopyHint(null), 1500);
      return;
    }
  });

  const panelW = Math.min(110, Math.max(60, width - 6));
  const panelH = Math.min(height - 4, Math.max(15, visible.length + 8));

  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={theme.bg}
      justifyContent="center"
      alignItems="center"
    >
      <box
        flexDirection="column"
        width={panelW}
        height={panelH}
        border
        borderStyle="rounded"
        borderColor={theme.transmission}
        backgroundColor={theme.bgPanel}
        padding={1}
      >
        <box flexDirection="row">
          <text fg={theme.transmission}>
            <strong>homeworld comms — full log</strong>
          </text>
          <text fg={theme.textMuted}>
            {"  "}
            {visible.length}/{entries.length} entries
            {filter ? ` · filter: ${filter === "medium" ? "med+high" : filter}` : ""}
            {copyHint ? `  · ${copyHint}` : ""}
          </text>
        </box>
        <text fg={theme.textDim}>↑↓ scroll · 1 low · 2 med+ · 3 high · 0 clear · c copy · esc close</text>
        <box flexDirection="column" marginTop={1} flexGrow={1}>
          {visible.length === 0 && (
            <text fg={theme.textMuted}>
              {entries.length === 0
                ? "no transmissions yet — glorp files them as it works."
                : "no entries match the current filter."}
            </text>
          )}
          {visible.slice(0, panelH - 6).map((e, i) => {
            const highlighted = i === clamped;
            const fg = highlighted ? theme.bg : SEVERITY_COLORS[e.severity];
            const bg = highlighted ? SEVERITY_COLORS[e.severity] : "transparent";
            const glyph = SEVERITY_GLYPHS[e.severity];
            const when = relativeTime(new Date(e.ts));
            const head = `${glyph} ${e.subject}`;
            return (
              <box key={`${e.ts}-${i}`} flexDirection="column">
                <text fg={fg} bg={bg}>
                  {` ${head.padEnd(panelW - 18, " ")}${when.padStart(12, " ")} `}
                </text>
                {highlighted && (
                  <text fg={theme.textMuted}>{`   ${e.body.slice(0, panelW - 8)}`}</text>
                )}
              </box>
            );
          })}
        </box>
      </box>
    </box>
  );
}

function readEntries(dataDir: string): TransmissionEntry[] {
  const file = path.join(dataDir, "transmissions.jsonl");
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const out: TransmissionEntry[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed?.subject && parsed?.body && parsed?.ts) {
          out.push({
            ts: parsed.ts,
            subject: parsed.subject,
            body: parsed.body,
            severity: parsed.severity ?? "low",
          });
        }
      } catch {
        // skip malformed line
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Best-effort OSC 52 clipboard write — works in most modern terminals. */
function copyToClipboard(text: string): void {
  const b64 = Buffer.from(text, "utf-8").toString("base64");
  // OSC 52 ; clipboard ; payload BEL
  process.stdout.write(`\x1b]52;c;${b64}\x07`);
}
