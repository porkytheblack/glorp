import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import { extensionReadRoots, resolveSafePath, relPath, isDir } from "./fs-shared.ts";
import { firstItems } from "./summaries.ts";
import type { SummaryTool } from "./summaries.ts";

const MAX_ENTRIES = 500;

interface LsSummaryArgs {
  path: string;
  count: number;
  shown: number;
  truncated: boolean;
  entries: string[];
}

export function lsTool(workspace: string): SummaryTool<{
  path?: string;
  show_hidden?: boolean;
}, LsSummaryArgs> {
  return {
    name: "ls",
    description: "List directory contents with file types and sizes. Use to explore an unfamiliar tree.",
    inputSchema: z.object({
      path: z.string().optional().describe("Directory to list (default: workspace root)"),
      show_hidden: z.boolean().optional().describe("Include dot-files (default: false)"),
    }),
    async do(input) {
      const abs = input.path ? resolveSafePath(workspace, input.path, extensionReadRoots(workspace)) : workspace;
      if (!(await isDir(abs))) {
        return { status: "error", data: null, message: `Not a directory: ${relPath(workspace, abs)}` };
      }
      const entries = await fs.promises.readdir(abs, { withFileTypes: true });
      const filtered = input.show_hidden
        ? entries
        : entries.filter((e) => !e.name.startsWith("."));
      filtered.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      const rows = await Promise.all(
        filtered.slice(0, MAX_ENTRIES).map(async (e) => {
          const full = path.join(abs, e.name);
          if (e.isDirectory()) return `[dir]  ${e.name}/`;
          try {
            const st = await fs.promises.stat(full);
            return `[file] ${e.name}  (${st.size} B)`;
          } catch {
            return `[file] ${e.name}`;
          }
        }),
      );
      const truncated = filtered.length > MAX_ENTRIES;
      return {
        status: "success",
        data:
          `${relPath(workspace, abs)}:\n` +
          (rows.length === 0
            ? "(empty directory)"
            : rows.join("\n") +
              (truncated ? `\n... [${filtered.length - MAX_ENTRIES} entries omitted]` : "")),
        generateSummaryArgs: {
          path: relPath(workspace, abs),
          count: filtered.length,
          shown: rows.length,
          truncated,
          entries: rows.slice(0, 50),
        } satisfies LsSummaryArgs,
        renderData: { path: relPath(workspace, abs), count: filtered.length, truncated },
      };
    },
    generateToolSummary: async (args) => {
      const a = args as LsSummaryArgs;
      if (a.count === 0) return `ls ${a.path}: empty directory.`;
      return [
        `ls ${a.path}: ${a.count} entr${a.count === 1 ? "y" : "ies"}${
          a.truncated ? ` (${a.shown} shown, capped)` : ""
        }.`,
        firstItems(a.entries, 20),
        "Full prior directory listing omitted; re-run ls or glob if needed.",
      ].join("\n");
    },
  };
}
