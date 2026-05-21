import * as path from "node:path";
import * as fs from "node:fs";

/** Shared directory blocklist for tree-walking tools (glob, grep). */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
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

/**
 * Resolve a user-supplied path against the workspace root and refuse
 * anything that escapes it. Returns an absolute path or throws.
 *
 * Note: does NOT canonicalize symlinks. A symlink inside the workspace
 * that points outside is accepted — fine for an in-process coding agent
 * (the user owns the workspace), but worth knowing if the threat model
 * ever changes.
 */
export function resolveSafePath(workspace: string, p: string): string {
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(workspace, p);
  const rel = path.relative(workspace, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `Path "${p}" is outside the workspace (${workspace}). Glorp refuses on principle.`,
    );
  }
  return abs;
}

export function relPath(workspace: string, p: string): string {
  return path.relative(workspace, p) || ".";
}

export async function isDir(p: string): Promise<boolean> {
  try {
    const s = await fs.promises.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function isFile(p: string): Promise<boolean> {
  try {
    const s = await fs.promises.stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

/**
 * Expand `{a,b,c}` brace groups into a flat list of patterns. Nested
 * braces are not supported (rare in practice; bash handles them via the
 * shell). Returns at least one pattern.
 */
export function expandBraces(glob: string): string[] {
  const open = glob.indexOf("{");
  if (open === -1) return [glob];
  let depth = 0;
  let close = -1;
  for (let i = open; i < glob.length; i++) {
    if (glob[i] === "{") depth++;
    else if (glob[i] === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return [glob];
  const head = glob.slice(0, open);
  const body = glob.slice(open + 1, close);
  const tail = glob.slice(close + 1);
  const out: string[] = [];
  for (const part of body.split(",")) {
    out.push(...expandBraces(head + part + tail));
  }
  return out.length === 0 ? [glob] : out;
}

/**
 * Glob matcher: supports `*`, `**`, `?`, `[abc]`, and `{a,b,c}` brace
 * expansion. `**` matches across directory separators; `*` and `?` do not.
 * Not a full shell glob — we hand bash off when complex.
 */
export function globToRegex(glob: string): RegExp {
  const patterns = expandBraces(glob).map(compileOne);
  if (patterns.length === 1) return patterns[0]!;
  return new RegExp(`^(?:${patterns.map((r) => r.source.slice(1, -1)).join("|")})$`);
}

function compileOne(glob: string): RegExp {
  let re = "^";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i += 2;
        if (glob[i] === "/") i++;
      } else {
        re += "[^/]*";
        i++;
      }
    } else if (c === "?") {
      re += "[^/]";
      i++;
    } else if (c === "[") {
      const end = glob.indexOf("]", i + 1);
      if (end === -1) {
        re += "\\[";
        i++;
      } else {
        re += glob.slice(i, end + 1);
        i = end + 1;
      }
    } else if ("\\^$.|+(){}".includes(c!)) {
      re += "\\" + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  re += "$";
  return new RegExp(re);
}
