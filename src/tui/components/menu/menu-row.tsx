import React from "react";
import { theme } from "../../theme.ts";
import type { FuzzyResult } from "./fuzzy.ts";
import type { MenuItem } from "./menu-list.tsx";

/** Filter input line shown at the top of a filterable menu. */
export function FilterInput({
  query, placeholder, accentColor,
}: { query: string; placeholder?: string; accentColor: string }) {
  return (
    <box flexDirection="row" marginBottom={1}>
      <text fg={accentColor}><strong>{"› "}</strong></text>
      {query.length > 0
        ? <text fg={theme.text}>{query}</text>
        : <text fg={theme.textDim}>{placeholder ?? "type to filter"}</text>}
      <text fg={accentColor}>▏</text>
    </box>
  );
}

/** Dim section header rendered above the first item of a new group. */
export function GroupHeader({ label }: { label: string }) {
  return (
    <box marginTop={1}>
      <text fg={theme.textDim}>{` ${label.toUpperCase()} `}</text>
    </box>
  );
}

interface RowProps {
  item: MenuItem;
  ranges: FuzzyResult["ranges"];
  selected: boolean;
  width: number;
  accentColor: string;
}

/**
 * A single menu row. The selected row fills its full width with the accent
 * background; matched characters get a subtle highlight; `detail` is
 * right-aligned within `width`.
 */
export function MenuRow({ item, ranges, selected, width, accentColor }: RowProps) {
  const bg = selected ? accentColor : "transparent";
  const baseFg = selected
    ? theme.menuSelText
    : item.disabled
      ? theme.textMuted
      : item.accent ?? theme.text;
  const matchFg = selected ? theme.menuSelText : theme.match;

  const icon = item.icon ? `${item.icon} ` : "";
  const hint = item.hint ? `  ${item.hint}` : "";
  const detail = item.detail ?? "";

  // Budget: leading space + icon + label(+hint) ... detail + trailing space.
  const left = ` ${icon}`;
  const labelMax = Math.max(
    1,
    width - left.length - hint.length - detail.length - 1,
  );
  const label = clip(item.label, labelMax);
  const used = left.length + label.length + hint.length + detail.length + 1;
  const pad = Math.max(1, width - used);

  return (
    <box flexDirection="row" width={width} backgroundColor={bg}>
      <text fg={baseFg} bg={bg}>{left}</text>
      {renderHighlighted(label, ranges, baseFg, matchFg, bg)}
      {hint && <text fg={selected ? theme.menuSelText : theme.textMuted} bg={bg}>{hint}</text>}
      <text fg={baseFg} bg={bg}>{" ".repeat(pad)}</text>
      {detail && (
        <text fg={selected ? theme.menuSelText : theme.textMuted} bg={bg}>{`${detail} `}</text>
      )}
    </box>
  );
}

/** Render `label` as <span> runs, tinting matched ranges with `matchFg`. */
function renderHighlighted(
  label: string,
  ranges: FuzzyResult["ranges"],
  baseFg: string,
  matchFg: string,
  bg: string,
) {
  if (ranges.length === 0) return <text fg={baseFg} bg={bg}>{label}</text>;
  const spans: React.ReactNode[] = [];
  let pos = 0;
  let k = 0;
  for (const [start, end] of ranges) {
    const s = Math.min(start, label.length);
    const e = Math.min(end, label.length);
    if (s > pos) spans.push(<span key={k++} fg={baseFg} bg={bg}>{label.slice(pos, s)}</span>);
    if (e > s) spans.push(<span key={k++} fg={matchFg} bg={bg}><strong>{label.slice(s, e)}</strong></span>);
    pos = e;
  }
  if (pos < label.length) spans.push(<span key={k++} fg={baseFg} bg={bg}>{label.slice(pos)}</span>);
  return <text bg={bg}>{spans}</text>;
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(1, max - 1)) + "…";
}
