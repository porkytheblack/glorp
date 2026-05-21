import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import type { GloveFoldArgs } from "glove-core";
import { resolveSafePath, relPath, globToRegex } from "./fs-shared.ts";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "build",
  ".cache",
  ".venv",
  "__pycache__",
  "target",
  ".idea",
  ".vscode",
]);

async function* walk(root: string, ignore: Set<string>): AsyncGenerator<string> {
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".env" && e.name !== ".gitignore") {
      // Allow hidden files but skip hidden dirs.
      if (e.isDirectory()) continue;
    }
    if (e.isDirectory()) {
      if (ignore.has(e.name)) continue;
      yield* walk(path.join(root, e.name), ignore);
    } else if (e.isFile()) {
      yield path.join(root, e.name);
    }
  }
}

export function globTool(workspace: string): GloveFoldArgs<{
  pattern: string;
  path?: string;
  limit?: number;
}> {
  return {
    name: "glob",
    description:
      "Find files matching a glob pattern. Supports `*`, `**`, `?`, and `[abc]`. " +
      "Returns file paths relative to the workspace, sorted by recency (most recent first).",
    inputSchema: z.object({
      pattern: z.string().describe('Glob pattern, e.g. "**/*.ts" or "src/**/*.{ts,tsx}"'),
      path: z.string().optional().describe("Subdirectory to search in (default: workspace root)"),
      limit: z.number().int().min(1).max(2000).optional().describe("Max paths to return (default 500)"),
    }),
    async do(input) {
      const root = input.path ? resolveSafePath(workspace, input.path) : workspace;
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
        renderData: {
          pattern: input.pattern,
          root: relPath(workspace, root),
          count: final.length,
          truncated: hits.length > limit,
        },
      };
    },
  };
}
