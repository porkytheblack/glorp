import React, { useEffect, useState } from "react";
import type { ToolEvent } from "../../shared/events.ts";
import { theme } from "../theme.ts";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const STATIC_GLYPHS = {
  success: "✓",
  error: "✗",
  aborted: "⊘",
} as const;

const STATUS_COLORS: Record<ToolEvent["status"], string> = {
  running: theme.warning,
  success: theme.success,
  error: theme.error,
  aborted: theme.textMuted,
};

function useSpinner(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 90);
    return () => clearInterval(t);
  }, [active]);
  return SPINNER_FRAMES[frame]!;
}

function safeStringify(input: unknown): string {
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

/**
 * One-line summary of the tool input — never multi-line. Tool-specific so
 * the friend-shape sees "read src/foo.ts" not "{path:'src/foo.ts'}".
 */
function summarise(tool: ToolEvent): string {
  const input = tool.input as Record<string, unknown> | undefined;
  if (!input) return tool.name;
  if (tool.name.startsWith("glove_resources_")) return summariseResource(tool.name, input);
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
    case "apply_patch":
      return `apply_patch (${truncate(input.patch as string, 50)})`;
    case "glorp_update_plan":
      return `plan · ${truncate(input.title as string, 60)}`;
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
    case "glove_update_tasks":
      return `update_tasks (${(input.todos as unknown[] | undefined)?.length ?? 0})`;
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
    case "spawn_agent":
      return `spawn ${input.role ?? "agent"} · ${truncate((input.label ?? input.task) as string, 55)}`;
    default:
      return `${tool.name} ${truncate(safeStringify(input), 70)}`;
  }
}

function summariseResource(name: string, input: Record<string, unknown>): string {
  const op = name.replace("glove_resources_", "resources ");
  const path = (input.path ?? input.fromPath ?? input.targetId ?? input.pattern ?? "") as string;
  if (name === "glove_resources_write") return `resources write ${input.path as string}`;
  if (name === "glove_resources_edit") return `resources edit ${input.path as string}`;
  if (name === "glove_resources_move") return `resources move ${input.fromPath as string}`;
  if (name === "glove_resources_grep") return `resources grep ${truncate(input.query as string, 50)}`;
  return `${op}${path ? ` ${truncate(path, 70)}` : ""}`;
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
  const isRunning = tool.status === "running";
  const showOutput = !isRunning;
  const lines = preview(tool, 10);
  const spinnerFrame = useSpinner(isRunning);
  const glyph = isRunning
    ? spinnerFrame
    : STATIC_GLYPHS[tool.status as keyof typeof STATIC_GLYPHS] ?? "·";
  // Edit tools get a tiny diff display via renderData.
  const editData =
    tool.name === "edit" && tool.renderData
      ? (tool.renderData as { old?: string; new?: string })
      : null;
  const patchData =
    tool.name === "apply_patch" && tool.renderData
      ? (tool.renderData as { patch?: string })
      : null;
  const oldLines = editData?.old?.split("\n") ?? [];
  const newLines = editData?.new?.split("\n") ?? [];
  const oldShown = oldLines.slice(0, 4);
  const newShown = newLines.slice(0, 4);
  return (
    <box flexDirection="column" marginBottom={1}>
      <box flexDirection="row">
        <text fg={STATUS_COLORS[tool.status]}>{glyph}</text>
        <text> </text>
        <text fg={theme.toolName}>
          <strong>{summarise(tool)}</strong>
        </text>
      </box>
      {editData && (
        <box flexDirection="column" marginLeft={2} marginTop={1}>
          {oldShown.map((l, i) => (
            <text key={`o${i}`} bg={theme.diffDel} fg={theme.diffDelText}>
              - {truncate(l, 100)}
            </text>
          ))}
          {oldLines.length > oldShown.length && (
            <text fg={theme.textDim}>  … +{oldLines.length - oldShown.length} more removed</text>
          )}
          {newShown.map((l, i) => (
            <text key={`n${i}`} bg={theme.diffAdd} fg={theme.diffAddText}>
              + {truncate(l, 100)}
            </text>
          ))}
          {newLines.length > newShown.length && (
            <text fg={theme.textDim}>  … +{newLines.length - newShown.length} more added</text>
          )}
        </box>
      )}
      {patchData?.patch && (
        <box flexDirection="column" marginLeft={2} marginTop={1}>
          {patchData.patch
            .split("\n")
            .filter((l) => l.startsWith("+") || l.startsWith("-"))
            .filter((l) => !l.startsWith("+++") && !l.startsWith("---"))
            .slice(0, 8)
            .map((l, i) => (
              <text
                key={`p${i}`}
                bg={l.startsWith("+") ? theme.diffAdd : theme.diffDel}
                fg={l.startsWith("+") ? theme.diffAddText : theme.diffDelText}
              >
                {truncate(l, 100)}
              </text>
            ))}
        </box>
      )}
      {showOutput && lines.length > 0 && !editData && !patchData && (
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
