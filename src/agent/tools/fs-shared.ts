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
 * Containment is checked twice: once lexically (cheap; rejects `../`
 * climbing), then again after canonicalising both ends through symlinks
 * (catches a workspace-internal symlink pointing at e.g. /etc/shadow or
 * ~/.ssh, which a freshly-cloned repo can easily plant).
 */
export function resolveSafePath(workspace: string, p: string): string {
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(workspace, p);
  const rel = path.relative(workspace, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `Path "${p}" is outside the workspace. Glorp refuses on principle.`,
    );
  }
  const realWorkspace = safeRealpath(workspace);
  const realAbs = safeRealpath(abs);
  const realRel = path.relative(realWorkspace, realAbs);
  if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
    throw new Error(
      `Path "${p}" resolves outside the workspace via a symlink. Glorp refuses on principle.`,
    );
  }
  return abs;
}

/**
 * realpath that tolerates the path not yet existing — for `write`, the
 * target file is new, but its parent directory should exist (or at least
 * the nearest existing ancestor must canonicalise inside the workspace).
 */
function safeRealpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) return p;
    return path.join(safeRealpath(parent), path.basename(p));
  }
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
 *
 * Capped at MAX_BRACE_EXPANSION outputs so a pattern like
 * `{a,b}{a,b}{a,b}…` from an untrusted caller can't blow up to 2^N
 * regex compilations.
 */
const MAX_BRACE_EXPANSION = 256;
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
    for (const expanded of expandBraces(head + part + tail)) {
      out.push(expanded);
      if (out.length > MAX_BRACE_EXPANSION) {
        throw new Error(
          `glob brace expansion exceeded ${MAX_BRACE_EXPANSION} patterns — refusing`,
        );
      }
    }
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
