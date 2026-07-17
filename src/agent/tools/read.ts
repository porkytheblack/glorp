import { z } from "zod";
import * as fs from "node:fs";
import { extensionReadRoots, resolveSafePath, relPath, isFile } from "./fs-shared.ts";
import type { SummaryTool } from "./summaries.ts";

const MAX_BYTES = 1024 * 1024; // 1 MB cap before we truncate.
const DEFAULT_LINES = 500;
const MAX_LINES = 2000;
// Minified/generated files can pack the whole 1 MB into one "line" — without
// these caps a single read could dump ~250k tokens into the context window.
const MAX_LINE_CHARS = 2000;
const MAX_READ_CHARS = 80_000;

interface ReadSummaryArgs {
  path: string;
  start: number;
  end: number;
  totalLines: number;
  bytes: number;
  truncatedByBytes: boolean;
  limitedByLines: boolean;
}

export function readTool(workspace: string): SummaryTool<{
  path: string;
  offset?: number;
  limit?: number;
}, ReadSummaryArgs> {
  return {
    name: "read",
    description:
      "Read a file from the workspace. Returns content with line numbers (1-indexed). " +
      "For large files, use offset (1-based starting line) and limit (lines). " +
      "Always use this BEFORE editing a file.",
    inputSchema: z.object({
      path: z.string().describe("File path (absolute or relative to workspace)"),
      offset: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("1-based line number to start reading from"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_LINES)
        .optional()
        .describe(`Max lines to read (default ${DEFAULT_LINES}, max ${MAX_LINES})`),
    }),
    async do(input) {
      const abs = resolveSafePath(workspace, input.path, extensionReadRoots(workspace));
      if (!(await isFile(abs))) {
        return {
          status: "error",
          data: null,
          message: `Not a file: ${relPath(workspace, abs)}`,
        };
      }
      const stat = await fs.promises.stat(abs);
      let body: string;
      if (stat.size > MAX_BYTES) {
        const fh = await fs.promises.open(abs, "r");
        try {
          const buf = Buffer.alloc(MAX_BYTES);
          await fh.read(buf, 0, MAX_BYTES, 0);
          body = buf.toString("utf-8") + `\n... [truncated, file is ${stat.size} bytes]`;
        } finally {
          await fh.close();
        }
      } else {
        body = await fs.promises.readFile(abs, "utf-8");
      }
      const lines = body.split("\n");
      const start = (input.offset ?? 1) - 1;
      const requestedEnd = Math.min(lines.length, start + (input.limit ?? DEFAULT_LINES));
      const numberedLines: string[] = [];
      let budget = MAX_READ_CHARS;
      let end = start;
      for (let i = start; i < requestedEnd; i++) {
        const raw = lines[i]!;
        const line = raw.length > MAX_LINE_CHARS
          ? `${raw.slice(0, MAX_LINE_CHARS)}... [line truncated, ${raw.length} chars total]`
          : raw;
        const row = `${String(i + 1).padStart(5, " ")}→${line}`;
        if (numberedLines.length > 0 && row.length + 1 > budget) break;
        numberedLines.push(row);
        budget -= row.length + 1;
        end = i + 1;
      }
      const numbered = numberedLines.join("\n");
      const charClamped = end < requestedEnd;
      const more =
        end < lines.length
          ? `\n... [${lines.length - end} more lines${
              charClamped ? ` — output clamped at ~${MAX_READ_CHARS} chars` : ""
            } — call read again with offset=${end + 1}]`
          : "";
      return {
        status: "success",
        data: numbered + more,
        generateSummaryArgs: {
          path: relPath(workspace, abs),
          start: start + 1,
          end,
          totalLines: lines.length,
          bytes: stat.size,
          truncatedByBytes: stat.size > MAX_BYTES,
          limitedByLines: end < lines.length,
        } satisfies ReadSummaryArgs,
        renderData: {
          path: relPath(workspace, abs),
          lines: lines.length,
          shown: numberedLines.length,
          start: start + 1,
        },
      };
    },
    generateToolSummary: async (args) => {
      const a = args as ReadSummaryArgs;
      const range = a.end >= a.start ? `lines ${a.start}-${a.end}` : `no lines at offset ${a.start}`;
      const suffix = [
        a.limitedByLines ? "line-limited" : "",
        a.truncatedByBytes ? `byte-truncated at ${MAX_BYTES} bytes` : "",
      ].filter(Boolean);
      return `Read ${a.path} (${range} of ${a.totalLines} lines, ${a.bytes} bytes)${
        suffix.length ? ` [${suffix.join(", ")}]` : ""
      }. Full prior contents omitted; re-read a targeted range if needed.`;
    },
  };
}
