import type { SlashCommand } from "../slash-menu.tsx";

export interface HintToken {
  query: string;
  start: number;
  end: number;
  trigger: "/" | "$" | "@";
}

export function isCtrlC(key: { name?: string; sequence?: string; ctrl?: boolean }): boolean {
  return key.sequence === "\u0003" || (key.ctrl === true && key.name === "c");
}

export function printableKeyText(key: {
  name?: string; sequence?: string; ctrl?: boolean; meta?: boolean; super?: boolean;
}): string | undefined {
  if (key.ctrl || key.meta || key.super) return undefined;
  if (key.name === "space") return " ";
  if (!key.sequence || key.sequence.length !== 1) return undefined;
  const code = key.sequence.charCodeAt(0);
  if (code < 32 || code === 127) return undefined;
  return key.sequence;
}

export function normalizeSkillAlias(text: string, skillHints: SlashCommand[]): string {
  const match = /^(\s*)\$([^\s]+)(.*)$/s.exec(text);
  if (!match) return text;
  const [, leading = "", name = "", rest = ""] = match;
  if (!skillHints.some((s) => s.name === `$${name}`)) return text;
  return `${leading}/${name}${rest}`;
}

export function clampCursorOffset(text: string, cursor: number | undefined): number {
  if (typeof cursor !== "number" || !Number.isFinite(cursor)) return text.length;
  return Math.max(0, Math.min(text.length, Math.floor(cursor)));
}

export function findActiveHintToken(text: string, cursor = text.length): HintToken | null {
  const end = clampCursorOffset(text, cursor);
  const beforeCursor = text.slice(0, end);
  const match = /(^|[\s([{,;])([/$@][^\s]*)$/.exec(beforeCursor);
  if (!match?.[2]) return null;
  const query = match[2];
  const trigger = query[0];
  if (trigger !== "/" && trigger !== "$" && trigger !== "@") return null;
  return { query, start: end - query.length, end, trigger };
}
