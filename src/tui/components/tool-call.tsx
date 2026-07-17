import React, { useEffect, useState } from "react";
import type { ToolEvent } from "../../shared/events.ts";
import { theme } from "../theme.ts";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const GLYPHS = { success: "✓", error: "✗", aborted: "⊘" } as const;
const COLORS: Record<ToolEvent["status"], string> = {
  running: theme.warning, success: theme.success, error: theme.error, aborted: theme.textMuted,
};

export function ToolCallRow({ tool }: { tool: ToolEvent }) {
  const running = tool.status === "running";
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), 90);
    return () => clearInterval(t);
  }, [running]);

  const glyph = running ? SPINNER[frame]! : GLYPHS[tool.status as keyof typeof GLYPHS] ?? "·";
  const editData = tool.name === "edit" && tool.renderData
    ? (tool.renderData as { old?: string; new?: string }) : null;
  const patchData = tool.name === "apply_patch" && tool.renderData
    ? (tool.renderData as { patch?: string }) : null;
  const duration = formatDuration(tool);

  return (
    <box flexDirection="column" marginBottom={0}>
      <box flexDirection="row">
        <box width={6} marginRight={1}>
          <text fg={theme.textDim}> </text>
        </box>
        <text fg={COLORS[tool.status]}>{glyph} </text>
        <text fg={theme.toolName}>{summarise(tool)}</text>
        {duration && <text fg={theme.textDim}> ({duration})</text>}
      </box>
      {editData && <EditDiff editData={editData} />}
      {patchData?.patch && <PatchDiff patch={patchData.patch} />}
    </box>
  );
}

/** Elapsed time for finished tools, shown from 1s up so quick calls stay quiet. */
function formatDuration(tool: ToolEvent): string | null {
  if (tool.status === "running" || !tool.endedAt) return null;
  const ms = tool.endedAt - tool.startedAt;
  if (ms < 1000) return null;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

function EditDiff({ editData }: { editData: { old?: string; new?: string } }) {
  const oldLines = (editData.old ?? "").split("\n").slice(0, 3);
  const newLines = (editData.new ?? "").split("\n").slice(0, 3);
  return (
    <box flexDirection="column" marginLeft={9}>
      {oldLines.map((l, i) => (
        <text key={`o${i}`} bg={theme.diffDel} fg={theme.diffDelText}>- {clip(l, 90)}</text>
      ))}
      {newLines.map((l, i) => (
        <text key={`n${i}`} bg={theme.diffAdd} fg={theme.diffAddText}>+ {clip(l, 90)}</text>
      ))}
    </box>
  );
}

function PatchDiff({ patch }: { patch: string }) {
  const lines = patch.split("\n")
    .filter((l) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---"))
    .slice(0, 6);
  return (
    <box flexDirection="column" marginLeft={9}>
      {lines.map((l, i) => (
        <text key={`p${i}`}
          bg={l.startsWith("+") ? theme.diffAdd : theme.diffDel}
          fg={l.startsWith("+") ? theme.diffAddText : theme.diffDelText}
        >{clip(l, 90)}</text>
      ))}
    </box>
  );
}

function summarise(tool: ToolEvent): string {
  const input = tool.input as Record<string, unknown> | undefined;
  const mcp = splitMcpName(tool.name);
  if (mcp) return `⌁ ${mcp.server} · ${mcp.tool}${input ? ` ${clip(safeStr(input), 48)}` : ""}`;
  if (!input) return tool.name;
  switch (tool.name) {
    case "read": {
      const p = input.path as string;
      const off = input.offset ? ` @${input.offset}` : "";
      const lim = input.limit ? `+${input.limit}` : "";
      return `read ${p}${off}${lim}`;
    }
    case "write": return `write ${input.path as string}`;
    case "edit": return `edit ${input.path as string}`;
    case "bash": {
      const desc = (input.description as string) || (input.command as string);
      return `bash · ${clip(desc, 60)}`;
    }
    case "glob": return `glob ${input.pattern as string}`;
    case "grep": return `grep /${clip(input.pattern as string, 40)}/`;
    case "ls": return `ls ${(input.path as string) ?? "."}`;
    case "web_fetch": return `fetch ${clip(input.url as string, 60)}`;
    case "glove_invoke_subagent": return `@${input.name} ${clip(input.prompt as string, 50)}`;
    case "glove_invoke_skill": return `/${input.name as string}`;
    case "glove_update_tasks": return "update task list";
    case "glove_post_to_inbox": return `inbox ← ${clip((input.tag as string) ?? "", 40)}`;
    default: return `${tool.name} ${clip(safeStr(input), 60)}`;
  }
}

/** Bridged MCP tools are named `<server>__<tool>` (glove-mcp namespace). */
function splitMcpName(name: string): { server: string; tool: string } | null {
  const sep = name.indexOf("__");
  if (sep <= 0 || sep + 2 >= name.length) return null;
  if (name.startsWith("glove_")) return null;
  return { server: name.slice(0, sep), tool: name.slice(sep + 2) };
}

function clip(s: string | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function safeStr(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}
