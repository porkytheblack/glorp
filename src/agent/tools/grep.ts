import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveSafePath, globToRegex, IGNORED_DIRS } from "./fs-shared.ts";
import { firstItems } from "./summaries.ts";
import type { SummaryTool } from "./summaries.ts";

interface GrepSummaryArgs {
  pattern: string;
  root: string;
  glob?: string;
  total: number;
  truncated: boolean;
  context: number;
  files: Array<{ path: string; count: number; firstLine: number }>;
}

async function* walk(root: string): AsyncGenerator<string> {
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      if (IGNORED_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      yield* walk(path.join(root, e.name));
    } else if (e.isFile()) {
      yield path.join(root, e.name);
    }
  }
}

export function grepTool(workspace: string): SummaryTool<{
  pattern: string;
  path?: string;
  glob?: string;
  case_insensitive?: boolean;
  max_results?: number;
  context?: number;
}, GrepSummaryArgs> {
  return {
    name: "grep",
    description:
      "Search for a regex pattern across files. Returns matches with file:line:text. " +
      "Use `glob` to restrict by filename pattern. Set `context` for surrounding lines.",
    inputSchema: z.object({
      pattern: z.string().describe("Regex pattern (JS syntax)"),
      path: z.string().optional().describe("Subdirectory to search in"),
      glob: z.string().optional().describe('Glob filter for filenames, e.g. "**/*.ts"'),
      case_insensitive: z.boolean().optional().describe("Case-insensitive match"),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe("Max matches to return (default 200)"),
      context: z
        .number()
        .int()
        .min(0)
        .max(10)
        .optional()
        .describe("Lines of context before/after each match (default 0)"),
    }),
    async do(input) {
      let re: RegExp;
      try {
        re = new RegExp(input.pattern, input.case_insensitive ? "i" : "");
      } catch (err: any) {
        return { status: "error", data: null, message: `Invalid regex: ${err.message}` };
      }
      const root = input.path ? resolveSafePath(workspace, input.path) : workspace;
      const filenameRe = input.glob ? globToRegex(input.glob) : null;
      const max = input.max_results ?? 200;
      const ctx = input.context ?? 0;
      const out: string[] = [];
      const byFile = new Map<string, { count: number; firstLine: number }>();
      let total = 0;

      for await (const file of walk(root)) {
        const rel = path.relative(workspace, file);
        if (filenameRe && !filenameRe.test(rel) && !filenameRe.test(path.basename(file))) continue;
        let body: string;
        try {
          const stat = await fs.promises.stat(file);
          if (stat.size > 1024 * 1024) continue; // skip huge files
          body = await fs.promises.readFile(file, "utf-8");
        } catch {
          continue;
        }
        const lines = body.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i]!)) {
            const current = byFile.get(rel);
            if (current) current.count++;
            else byFile.set(rel, { count: 1, firstLine: i + 1 });
            const start = Math.max(0, i - ctx);
            const end = Math.min(lines.length, i + ctx + 1);
            if (ctx > 0) out.push(`--- ${rel}`);
            for (let j = start; j < end; j++) {
              out.push(`${rel}:${j + 1}:${lines[j]}`);
            }
            total++;
            if (total >= max) break;
          }
        }
        if (total >= max) break;
      }
      return {
        status: "success",
        data: out.length === 0 ? "(no matches)" : out.join("\n"),
        generateSummaryArgs: {
          pattern: input.pattern,
          root: path.relative(workspace, root) || ".",
          glob: input.glob,
          total,
          truncated: total >= max,
          context: ctx,
          files: Array.from(byFile.entries()).map(([file, info]) => ({
            path: file,
            count: info.count,
            firstLine: info.firstLine,
          })),
        } satisfies GrepSummaryArgs,
        renderData: { pattern: input.pattern, count: total, truncated: total >= max },
      };
    },
    generateToolSummary: async (args) => {
      const a = args as GrepSummaryArgs;
      if (a.total === 0) {
        return `grep /${a.pattern}/ in ${a.root}${a.glob ? ` (${a.glob})` : ""}: no matches.`;
      }
      const files = a.files.map((f) => `${f.path}:${f.firstLine} (${f.count} match${f.count === 1 ? "" : "es"})`);
      return [
        `grep /${a.pattern}/ in ${a.root}${a.glob ? ` (${a.glob})` : ""}: ${a.total} match${
          a.total === 1 ? "" : "es"
        } across ${a.files.length} file${a.files.length === 1 ? "" : "s"}${a.truncated ? " (truncated)" : ""}.`,
        a.context ? `Context requested: ${a.context} line${a.context === 1 ? "" : "s"}.` : "",
        firstItems(files, 20),
        "Full prior match text omitted; re-run grep or read specific files if needed.",
      ].filter(Boolean).join("\n");
    },
  };
}
