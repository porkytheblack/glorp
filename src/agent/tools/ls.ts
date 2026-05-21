import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import type { GloveFoldArgs } from "glove-core";
import { resolveSafePath, relPath, isDir } from "./fs-shared.ts";

export function lsTool(workspace: string): GloveFoldArgs<{
  path?: string;
  show_hidden?: boolean;
}> {
  return {
    name: "ls",
    description: "List directory contents with file types and sizes. Use to explore an unfamiliar tree.",
    inputSchema: z.object({
      path: z.string().optional().describe("Directory to list (default: workspace root)"),
      show_hidden: z.boolean().optional().describe("Include dot-files (default: false)"),
    }),
    async do(input) {
      const abs = input.path ? resolveSafePath(workspace, input.path) : workspace;
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
        filtered.map(async (e) => {
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
      return {
        status: "success",
        data:
          `${relPath(workspace, abs)}:\n` +
          (rows.length === 0 ? "(empty directory)" : rows.join("\n")),
        renderData: { path: relPath(workspace, abs), count: rows.length },
      };
    },
  };
}
