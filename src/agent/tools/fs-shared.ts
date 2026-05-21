import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Resolve a user-supplied path against the workspace root and refuse
 * anything that escapes it. Returns an absolute path or throws.
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
 * Simple glob matcher: supports `*`, `**`, `?`, and `[abc]`.
 * Not a full shell glob — we hand bash off when complex.
 */
export function globToRegex(glob: string): RegExp {
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
