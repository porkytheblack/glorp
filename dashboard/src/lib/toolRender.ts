/**
 * Pure interpreters that turn a ToolEvent's loosely-typed `input`/`output`
 * into shapes the renderers (DiffView, ToolDetail) can consume directly.
 *
 * The field names mirror the backend tool definitions in
 * `src/agent/tools/*` (edit → path/old_string/new_string, write → path/content,
 * apply_patch → patch, read → path, bash → command/description, …). When a
 * field is missing or the input is an unexpected shape, callers fall back to a
 * pretty-printed JSON dump, so these helpers stay defensive and never throw.
 */

import type { ToolEvent } from "../types.ts";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** A before/after pair plus optional path, ready for DiffView's pair mode. */
export interface EditDiff {
  before: string;
  after: string;
  filePath?: string;
}

/** Extract a before/after diff from an `edit` tool's input. */
export function editDiff(input: unknown): EditDiff | null {
  const rec = asRecord(input);
  const before = str(rec.old_string);
  const after = str(rec.new_string);
  if (before === undefined || after === undefined) return null;
  return { before, after, filePath: str(rec.path) };
}

/** Extract the new file body from a `write` tool's input (all additions). */
export function writeDiff(input: unknown): EditDiff | null {
  const rec = asRecord(input);
  const content = str(rec.content);
  if (content === undefined) return null;
  return { before: "", after: content, filePath: str(rec.path) };
}

/** Extract the unified-diff string from an `apply_patch` tool's input. */
export function patchDiff(input: unknown): string | null {
  return str(asRecord(input).patch) ?? null;
}

/** Read-tool input → its file path, used for the read view header. */
export function readPath(input: unknown): string | undefined {
  return str(asRecord(input).path);
}

/** Bash-tool input → command + human description. */
export function bashCall(input: unknown): { command: string; description?: string } | null {
  const rec = asRecord(input);
  const command = str(rec.command);
  if (command === undefined) return null;
  return { command, description: str(rec.description) };
}

/** Search-like tools (grep/glob/ls) → a short subject for the summary line. */
export function searchSubject(name: string, input: unknown): string | undefined {
  const rec = asRecord(input);
  if (name === "grep") return str(rec.pattern);
  if (name === "glob") return str(rec.pattern);
  if (name === "ls") return str(rec.path) ?? ".";
  return undefined;
}

/**
 * A one-line subject for a tool's summary row: the file path, command, or
 * search pattern — whatever best identifies this specific call.
 */
export function toolSubject(tool: ToolEvent): string | undefined {
  const rec = asRecord(tool.input);
  switch (tool.name) {
    case "edit":
    case "write":
    case "read":
      return str(rec.path);
    case "apply_patch": {
      const files = asRecord(tool.renderData).files;
      return Array.isArray(files) ? files.filter((f) => typeof f === "string").join(", ") : undefined;
    }
    case "bash":
      return str(rec.command);
    default:
      return searchSubject(tool.name, tool.input);
  }
}

/** Stable, indented JSON dump used by the default / fallback render path. */
export function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
