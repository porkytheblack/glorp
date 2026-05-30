/**
 * Rich renderer for a single agent tool call. Picks a body by `tool.name`:
 *   edit / apply_patch / write → DiffView   read → numbered file block
 *   bash → terminal block      grep / glob / ls → compact results list
 *   default → pretty JSON of input (+ output).
 *
 * Wrapped in a collapsible <details> whose summary mirrors ChatPanel's ToolRow
 * (status dot + name + short subject). Collapsed by default unless the call is
 * still running or errored, where the body is the most useful at a glance.
 */

import type { ToolEvent } from "../types.ts";
import { DiffView } from "./DiffView.tsx";
import {
  bashCall,
  editDiff,
  patchDiff,
  pretty,
  readPath,
  toolSubject,
  writeDiff,
} from "../lib/toolRender.ts";

const DOT: Record<ToolEvent["status"], string> = {
  running: "text-glorp-warn",
  success: "text-glorp-accent",
  error: "text-glorp-error",
  aborted: "text-glorp-muted",
};

function Block({ children }: { children: string }) {
  return (
    <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-glorp-border bg-glorp-bg px-2 py-1.5 text-[12px] text-glorp-muted">
      {children}
    </pre>
  );
}

/** Terminal-style body for bash: the command, then its captured output. */
function BashBody({ command, output }: { command: string; output?: string }) {
  return (
    <div className="mt-1 overflow-hidden rounded border border-glorp-border bg-glorp-bg text-[12px]">
      <div className="flex border-b border-glorp-border bg-glorp-surface-2 px-2 py-1">
        <span className="mr-2 shrink-0 select-none text-glorp-accent">$</span>
        <span className="whitespace-pre-wrap break-words text-glorp-text">{command}</span>
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-2 py-1.5 text-glorp-muted">
        {output && output.length > 0 ? output : "(no output)"}
      </pre>
    </div>
  );
}

function ToolBody({ tool }: { tool: ToolEvent }) {
  switch (tool.name) {
    case "edit": {
      const d = editDiff(tool.input);
      return d ? <DiffView before={d.before} after={d.after} filePath={d.filePath} /> : <Block>{pretty(tool.input)}</Block>;
    }
    case "write": {
      const d = writeDiff(tool.input);
      return d ? <DiffView before={d.before} after={d.after} filePath={d.filePath} /> : <Block>{pretty(tool.input)}</Block>;
    }
    case "apply_patch": {
      const p = patchDiff(tool.input);
      return p ? <DiffView diff={p} /> : <Block>{pretty(tool.input)}</Block>;
    }
    case "read": {
      const path = readPath(tool.input);
      return (
        <>
          {path && <div className="mt-1 text-glorp-muted">{path}</div>}
          <Block>{tool.output ?? "(no content yet)"}</Block>
        </>
      );
    }
    case "bash": {
      const call = bashCall(tool.input);
      return call ? <BashBody command={call.command} output={tool.output} /> : <Block>{pretty(tool.input)}</Block>;
    }
    case "grep":
    case "glob":
    case "ls":
      return <Block>{tool.output ?? "(no results yet)"}</Block>;
    default:
      return <Block>{pretty(tool.input) + (tool.output ? `\n\n${tool.output}` : "")}</Block>;
  }
}

export function ToolDetail({ tool }: { tool: ToolEvent }) {
  const open = tool.status === "running" || tool.status === "error";
  const subject = toolSubject(tool);
  return (
    <details open={open} className="rounded border border-glorp-border bg-glorp-surface px-2 py-1">
      <summary className="flex cursor-pointer list-none items-center gap-1.5">
        <span className={DOT[tool.status]}>●</span>
        <span className="text-glorp-text">{tool.name}</span>
        {subject && <span className="truncate text-glorp-muted">{subject}</span>}
      </summary>
      <ToolBody tool={tool} />
    </details>
  );
}
