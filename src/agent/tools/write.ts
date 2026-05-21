import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import type { GloveFoldArgs } from "glove-core";
import { resolveSafePath, relPath } from "./fs-shared.ts";

export function writeTool(workspace: string): GloveFoldArgs<{
  path: string;
  content: string;
}> {
  return {
    name: "write",
    description:
      "Write content to a file, creating directories as needed. Overwrites if file exists. " +
      "For partial edits, prefer the `edit` tool — write is for new files or full rewrites.",
    inputSchema: z.object({
      path: z.string().describe("File path (absolute or relative to workspace)"),
      content: z.string().describe("Full file content to write"),
    }),
    requiresPermission: false,
    async do(input) {
      const abs = resolveSafePath(workspace, input.path);
      const existed = fs.existsSync(abs);
      await fs.promises.mkdir(path.dirname(abs), { recursive: true });
      await fs.promises.writeFile(abs, input.content, "utf-8");
      const lines = input.content.split("\n").length;
      return {
        status: "success",
        data: `${existed ? "Overwrote" : "Created"} ${relPath(workspace, abs)} (${lines} lines, ${input.content.length} bytes)`,
        renderData: {
          path: relPath(workspace, abs),
          bytes: input.content.length,
          lines,
          existed,
        },
      };
    },
  };
}
