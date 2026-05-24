import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

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

/**
 * Path-like tokens we explicitly permit even though they aren't under the
 * workspace. `/dev/null` etc. are routine bash idioms (e.g. `cmd > /dev/null
 * 2>&1`) and have no read/write side-effect that could leak workspace
 * contents or import outside data.
 */
const OUTSIDE_TOKEN_ALLOWLIST: ReadonlySet<string> = new Set([
  "/dev/null",
  "/dev/stdin",
  "/dev/stdout",
  "/dev/stderr",
  "/dev/zero",
  "/dev/random",
  "/dev/urandom",
  "/dev/tty",
  "/dev/fd",
]);

/**
 * Does a shell command reference any filesystem path outside the workspace?
 *
 * Returns a one-line reason string when escape is detected, suitable for the
 * bash tool's confirmation modal; returns null when the command is workspace-
 * scoped or only references the small allowlist of generic /dev/* tokens.
 *
 * Detects two shapes:
 *   1. `cd <path>` / `pushd <path>` where the resolved target lies outside
 *      the workspace.
 *   2. Any whitespace-or-shell-operator-delimited token that begins with
 *      `/`, `~/`, `$HOME/`, or `${HOME}/` and whose expanded absolute form
 *      does not resolve under the workspace.
 *
 * This is a heuristic, not a sandbox — bash is a shell and can hide paths
 * inside command substitutions, eval, $( ), backticks, env vars, etc. The
 * goal is to catch the common-cases that happen *by accident* (the model
 * asked to read `/etc/passwd` or `~/.ssh/id_rsa`, redirected output to
 * `~/Desktop/foo`, or `cd ~/.config`) and force a one-shot confirm.
 * Determined misuse needs a real sandbox; that's a different layer.
 */
export function commandEscapesWorkspace(
  command: string,
  workspace: string,
  homeDir: string = os.homedir(),
): string | null {
  const cdReason = cdArgEscapes(command, workspace, homeDir);
  if (cdReason) return cdReason;
  return absoluteTokenEscapes(command, workspace, homeDir);
}

function cdArgEscapes(command: string, workspace: string, homeDir: string): string | null {
  // Match `cd <arg>` and `pushd <arg>` (not popd — it takes no path).
  // The arg ends at whitespace or a shell separator.
  const re = /\b(?:cd|pushd)\s+(--\s+)?([^\s|;&<>"'`)]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    const arg = m[2]!;
    if (!arg || arg === "-" || arg === ".") continue;
    if (arg === "~" || arg === "$HOME" || arg === "${HOME}") {
      return `\`cd ${arg}\` leaves the workspace`;
    }
    const abs = expandToAbsolute(arg, workspace, homeDir);
    if (abs == null) continue;
    if (!isUnder(abs, workspace)) {
      return `\`cd\` to a path outside the workspace: ${arg}`;
    }
  }
  return null;
}

function absoluteTokenEscapes(command: string, workspace: string, homeDir: string): string | null {
  // Look for tokens starting with /, ~/, $HOME/, ${HOME}/. The lookbehind
  // avoids matching mid-token slashes — word chars, dots, hyphens, and
  // colons cover identifiers and url schemes; the extra `/` exclusion
  // covers the second slash in `https://`, `git://`, etc. Stops at
  // whitespace or shell separators.
  const re = /(?<![\w\-.:/])(\/[^\s|;&<>"'`)]+|~\/[^\s|;&<>"'`)]+|\$(?:\{HOME\}|HOME)\/[^\s|;&<>"'`)]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    let tok = m[1]!.replace(/[)>;&|]+$/, "");
    if (!tok) continue;
    if (OUTSIDE_TOKEN_ALLOWLIST.has(tok)) continue;
    // Allowlist any /dev/fd/N subpath as well — process file descriptors.
    if (tok.startsWith("/dev/fd/")) continue;
    const abs = expandToAbsolute(tok, workspace, homeDir);
    if (abs == null) continue;
    if (!isUnder(abs, workspace)) {
      return `references path outside the workspace: ${tok}`;
    }
  }
  return null;
}

function expandToAbsolute(token: string, workspace: string, homeDir: string): string | null {
  let raw: string;
  if (token === "~" || token === "$HOME" || token === "${HOME}") raw = homeDir;
  else if (token.startsWith("~/")) raw = path.join(homeDir, token.slice(2));
  else if (token.startsWith("$HOME/")) raw = path.join(homeDir, token.slice(6));
  else if (token.startsWith("${HOME}/")) raw = path.join(homeDir, token.slice(8));
  else if (path.isAbsolute(token)) raw = token;
  else raw = path.resolve(workspace, token);
  try {
    return path.resolve(raw);
  } catch {
    return null;
  }
}

function isUnder(abs: string, workspace: string): boolean {
  const rel = path.relative(workspace, abs);
  if (rel === "") return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
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
