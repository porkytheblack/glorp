import React from "react";
import type { ToolEvent } from "../../shared/events.ts";
import { theme } from "../theme.ts";

const STATUS_GLYPHS: Record<ToolEvent["status"], string> = {
  running: "⠋",
  success: "✓",
  error: "✗",
  aborted: "⊘",
};

const STATUS_COLORS: Record<ToolEvent["status"], string> = {
  running: theme.warning,
  success: theme.success,
  error: theme.error,
  aborted: theme.textMuted,
};

/**
 * One-line summary of the tool input — never multi-line. Tool-specific so
 * the friend-shape sees "read src/foo.ts" not "{path:'src/foo.ts'}".
 */
function summarise(tool: ToolEvent): string {
  const input = tool.input as Record<string, unknown> | undefined;
  if (!input) return tool.name;
  switch (tool.name) {
    case "read": {
      const p = input.path as string;
      const off = input.offset ? ` @${input.offset}` : "";
      const lim = input.limit ? `+${input.limit}` : "";
      return `read ${p}${off}${lim}`;
    }
    case "write":
      return `write ${input.path as string}`;
    case "edit":
      return `edit ${input.path as string}`;
    case "bash": {
      const desc = (input.description as string) || (input.command as string);
      return `bash · ${truncate(desc, 70)}`;
    }
    case "glob":
      return `glob ${input.pattern as string}${input.path ? ` in ${input.path}` : ""}`;
    case "grep": {
      const g = input.glob ? ` (${input.glob})` : "";
      return `grep /${truncate(input.pattern as string, 50)}/${g}`;
    }
    case "ls":
      return `ls ${(input.path as string) ?? "."}`;
    case "web_fetch":
      return `web_fetch ${truncate(input.url as string, 70)}`;
    case "update_tasks":
      return `update_tasks (${(input.tasks as unknown[] | undefined)?.length ?? 0})`;
    case "glove_post_to_inbox":
      return `inbox ← ${truncate(input.request as string, 60)} [${input.tag}]`;
    case "dispatch_fleet":
      return `fleet/${input.kind} × ${(input.jobs as unknown[] | undefined)?.length ?? 0}`;
    case "transmission":
      return `transmission · ${truncate(input.subject as string, 60)}`;
    case "glove_invoke_subagent":
      return `@${input.name} ${truncate(input.prompt as string, 60)}`;
    case "glove_invoke_skill":
      return `/${input.name as string}${input.args ? ` ${truncate(String(input.args), 50)}` : ""}`;
    default:
      return `${tool.name} ${truncate(JSON.stringify(input), 70)}`;
  }
}

function truncate(s: string | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function preview(tool: ToolEvent, maxLines = 8): string[] {
  if (!tool.output) return [];
  const lines = tool.output.split("\n");
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines), `… (+${lines.length - maxLines} more lines)`];
}

export function ToolCallRow({ tool }: { tool: ToolEvent }) {
  const showOutput = tool.status !== "running";
  const lines = preview(tool, 10);
  // Edit tools get a tiny diff display via renderData.
  const editData =
    tool.name === "edit" && tool.renderData
      ? (tool.renderData as { old?: string; new?: string })
      : null;
  return (
    <box flexDirection="column" marginBottom={1}>
      <box flexDirection="row">
        <text fg={STATUS_COLORS[tool.status]}>{STATUS_GLYPHS[tool.status]}</text>
        <text> </text>
        <text fg={theme.toolName}>
          <strong>{summarise(tool)}</strong>
        </text>
      </box>
      {editData && (
        <box flexDirection="column" marginLeft={2} marginTop={1}>
          {editData.old?.split("\n").slice(0, 4).map((l, i) => (
            <text key={`o${i}`} bg={theme.diffDel} fg={theme.diffDelText}>
              - {truncate(l, 100)}
            </text>
          ))}
          {editData.new?.split("\n").slice(0, 4).map((l, i) => (
            <text key={`n${i}`} bg={theme.diffAdd} fg={theme.diffAddText}>
              + {truncate(l, 100)}
            </text>
          ))}
        </box>
      )}
      {showOutput && lines.length > 0 && !editData && (
        <box flexDirection="column" marginLeft={2} marginTop={1}>
          {lines.map((l, i) => (
            <text key={i} fg={theme.toolOutput}>
              {truncate(l, 200)}
            </text>
          ))}
        </box>
      )}
    </box>
  );
}
