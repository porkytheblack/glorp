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

  return (
    <box flexDirection="column" marginBottom={0}>
      <box flexDirection="row">
        <box width={6} marginRight={1}>
          <text fg={theme.textDim}> </text>
        </box>
        <text fg={COLORS[tool.status]}>{glyph} </text>
        <text fg={theme.toolName}>{summarise(tool)}</text>
      </box>
      {editData && <EditDiff editData={editData} />}
      {patchData?.patch && <PatchDiff patch={patchData.patch} />}
    </box>
  );
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
    case "glove_invoke_subagent": return `@${input.name} ${clip(input.prompt as string, 50)}`;
    case "glove_invoke_skill": return `/${input.name as string}`;
    default: return `${tool.name} ${clip(safeStr(input), 60)}`;
  }
}

function clip(s: string | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function safeStr(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}
