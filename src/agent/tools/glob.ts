import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import { extensionReadRoots, resolveSafePath, relPath, globToRegex, IGNORED_DIRS } from "./fs-shared.ts";
import { firstItems } from "./summaries.ts";
import type { SummaryTool } from "./summaries.ts";

// Hidden files that are still useful to surface in code searches.
const HIDDEN_ALLOWLIST = new Set([".env", ".env.example", ".gitignore", ".dockerignore", ".npmrc"]);

interface GlobSummaryArgs {
  pattern: string;
  root: string;
  count: number;
  truncated: boolean;
  paths: string[];
}

async function* walk(root: string, ignore: ReadonlySet<string>): AsyncGenerator<string> {
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name.startsWith(".") || ignore.has(e.name)) continue;
      yield* walk(path.join(root, e.name), ignore);
    } else if (e.isFile()) {
      if (e.name.startsWith(".") && !HIDDEN_ALLOWLIST.has(e.name)) continue;
      yield path.join(root, e.name);
    }
  }
}

export function globTool(workspace: string): SummaryTool<{
  pattern: string;
  path?: string;
  limit?: number;
}, GlobSummaryArgs> {
  return {
    name: "glob",
    description:
      "Find files matching a glob pattern. Supports `*`, `**`, `?`, `[abc]`, and `{a,b,c}` brace expansion. " +
      "Returns file paths relative to the workspace, sorted by recency (most recent first).",
    inputSchema: z.object({
      pattern: z.string().describe('Glob pattern, e.g. "**/*.ts" or "src/**/*.{ts,tsx}"'),
      path: z.string().optional().describe("Subdirectory to search in (default: workspace root)"),
      limit: z.number().int().min(1).max(2000).optional().describe("Max paths to return (default 500)"),
    }),
    async do(input) {
      const root = input.path ? resolveSafePath(workspace, input.path, extensionReadRoots(workspace)) : workspace;
      const limit = input.limit ?? 500;
      const re = globToRegex(input.pattern);
      const hits: { p: string; mtime: number }[] = [];
      try {
        for await (const file of walk(root, IGNORED_DIRS)) {
          const rel = path.relative(workspace, file);
          if (re.test(rel) || re.test(path.basename(file))) {
            try {
              const st = await fs.promises.stat(file);
              hits.push({ p: rel, mtime: st.mtimeMs });
            } catch {}
          }
          if (hits.length > limit * 5) break;
        }
      } catch (err: any) {
        return { status: "error", data: null, message: `glob failed: ${err.message}` };
      }
      hits.sort((a, b) => b.mtime - a.mtime);
      const final = hits.slice(0, limit).map((h) => h.p);
      return {
        status: "success",
        data: final.length === 0 ? "(no matches)" : final.join("\n"),
        generateSummaryArgs: {
          pattern: input.pattern,
          root: relPath(workspace, root),
          count: final.length,
          truncated: hits.length > limit,
          paths: final.slice(0, 50),
        } satisfies GlobSummaryArgs,
        renderData: {
          pattern: input.pattern,
          root: relPath(workspace, root),
          count: final.length,
          truncated: hits.length > limit,
        },
      };
    },
    generateToolSummary: async (args) => {
      const a = args as GlobSummaryArgs;
      if (a.count === 0) return `glob ${a.pattern} in ${a.root}: no matches.`;
      return [
        `glob ${a.pattern} in ${a.root}: ${a.count} path${a.count === 1 ? "" : "s"}${
          a.truncated ? " (truncated)" : ""
        }.`,
        firstItems(a.paths, 20),
        "Full prior path list omitted; re-run glob with a narrower pattern if needed.",
      ].join("\n");
    },
  };
}
