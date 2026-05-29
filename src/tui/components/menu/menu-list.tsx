import React, { useMemo, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { theme } from "../../theme.ts";
import { fuzzyFilter } from "./fuzzy.ts";
import { FilterInput, GroupHeader, MenuRow } from "./menu-row.tsx";

export interface MenuItem {
  id: string;
  label: string;
  detail?: string;        // right-aligned dim text (e.g. a shortcut, model, ctx %)
  hint?: string;          // small dim text appended after the label
  keywords?: string[];    // extra terms included in fuzzy matching
  icon?: string;          // single glyph shown before the label
  accent?: string;        // optional color override for this row's icon+label
  disabled?: boolean;     // not selectable; rendered dim
  group?: string;         // optional section label; consecutive items share a header
}

export interface MenuAction {
  key: string;            // matched against key.name (e.g. "x", "a")
  label: string;          // shown in the footer (e.g. "remove")
  run: (item: MenuItem | null) => void;
}

export interface MenuListProps {
  items: MenuItem[];
  onSubmit: (item: MenuItem) => void;
  onClose: () => void;
  width: number;
  filterable?: boolean;
  placeholder?: string;
  initialQuery?: string;
  accentColor?: string;
  maxVisible?: number;
  actions?: MenuAction[];
  emptyText?: string;
  footerHint?: string;
}

export function MenuList(props: MenuListProps): React.ReactElement {
  const {
    items, onSubmit, onClose, width,
    filterable = true, placeholder, initialQuery = "",
    accentColor = theme.menuSel, maxVisible = 12,
    actions = [], emptyText = "no matches", footerHint,
  } = props;

  const [query, setQuery] = useState(initialQuery);
  const [cursor, setCursor] = useState(0);

  const filtered = useMemo(
    () => fuzzyFilter(query, items, matchText),
    [query, items],
  );
  const clamped = Math.min(cursor, Math.max(0, filtered.length - 1));

  function move(delta: number) {
    setCursor((c) => {
      const n = filtered.length;
      if (n === 0) return 0;
      return Math.min(n - 1, Math.max(0, Math.min(c, n - 1) + delta));
    });
  }

  useKeyboard((key) => {
    if (key.name === "escape") return onClose();
    if (key.name === "up" || (key.ctrl && key.name === "p")) return move(-1);
    if (key.name === "down" || (key.ctrl && key.name === "n")) return move(1);
    if (key.name === "return" || key.name === "kpenter") {
      const entry = filtered[clamped];
      if (entry && !entry.item.disabled) onSubmit(entry.item);
      return;
    }
    const highlighted = filtered[clamped]?.item ?? null;
    if (!key.ctrl && !key.meta) {
      for (const action of actions) {
        if (key.name === action.key) { action.run(highlighted); return; }
      }
    }
    if (filterable && !key.ctrl && !key.meta) {
      if (key.name === "backspace") {
        setQuery((q) => q.slice(0, -1)); setCursor(0); return;
      }
      const ch = key.sequence;
      if (ch && ch.length === 1 && ch >= " " && ch !== "\x7f") {
        setQuery((q) => q + ch); setCursor(0);
      }
    }
  });

  const window = computeWindow(filtered.length, clamped, maxVisible);
  const footer = footerHint ?? autoFooter(actions);

  const tree = (
    <box flexDirection="column" width={width}>
      {filterable && (
        <FilterInput query={query} placeholder={placeholder} accentColor={accentColor} />
      )}
      {filtered.length === 0 ? (
        <text fg={theme.textMuted}>{` ${emptyText}`}</text>
      ) : (
        <box flexDirection="column">
          {window.above > 0 && (
            <text fg={theme.textDim}>{` ↑ ${window.above} more`}</text>
          )}
          {filtered.slice(window.start, window.end).map((entry, i) => {
            const absIdx = window.start + i;
            const prev = filtered[absIdx - 1]?.item.group;
            const showHeader = entry.item.group && entry.item.group !== prev;
            return (
              <React.Fragment key={entry.item.id}>
                {showHeader && <GroupHeader label={entry.item.group!} />}
                <MenuRow
                  item={entry.item}
                  ranges={entry.result.ranges}
                  selected={absIdx === clamped}
                  width={width}
                  accentColor={accentColor}
                />
              </React.Fragment>
            );
          })}
          {window.below > 0 && (
            <text fg={theme.textDim}>{` ↓ ${window.below} more`}</text>
          )}
        </box>
      )}
      <box marginTop={1}>
        <text fg={theme.footer}>{footer}</text>
      </box>
    </box>
  );
  return tree as React.ReactElement;
}

function matchText(item: MenuItem): string {
  return item.keywords?.length ? `${item.label} ${item.keywords.join(" ")}` : item.label;
}

function autoFooter(actions: MenuAction[]): string {
  let s = "↑↓ navigate · enter select · esc close";
  for (const a of actions) s += ` · ${a.key} ${a.label}`;
  return s;
}

interface Window { start: number; end: number; above: number; below: number; }

/** Compute a scrolling window of size `maxVisible` centered on `cursor`. */
function computeWindow(total: number, cursor: number, maxVisible: number): Window {
  if (total <= maxVisible) return { start: 0, end: total, above: 0, below: 0 };
  let start = cursor - Math.floor(maxVisible / 2);
  start = Math.max(0, Math.min(start, total - maxVisible));
  const end = start + maxVisible;
  return { start, end, above: start, below: total - end };
}
