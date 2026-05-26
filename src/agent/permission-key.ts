import { permissionKey as defaultPermissionKey } from "glove-core";
import { extractPatchPaths } from "./tools/apply-patch.ts";

/**
 * Glove 3.0.6 added input-aware permission keying — the executor now passes
 * the tool input on every gated call so the store can scope decisions per
 * input. The framework's default `permissionKey` exact-matches the full
 * JSON payload, which is too granular for tools whose input changes every
 * call (edit, write, apply_patch). We canonicalize per known tool so the
 * persistent permission set stays human-sized and "always allow X" actually
 * means something useful.
 *
 *   bash           → first command token  (e.g. "git", "rm", "node")
 *   edit / write   → absolute file path
 *   apply_patch    → sorted, joined set of touched paths
 *   dispatch_fleet → job kind
 *   everything else → framework default (exact JSON match)
 */
export function canonicalPermissionKey(toolName: string, input: unknown): string {
  switch (toolName) {
    case "bash": {
      const cmd = (input as { command?: unknown } | undefined)?.command;
      const token = typeof cmd === "string" ? firstCommandToken(cmd) : "";
      return `bash:${token || "*"}`;
    }
    case "edit":
    case "write": {
      const p = (input as { path?: unknown } | undefined)?.path;
      return `${toolName}:${typeof p === "string" ? p : "*"}`;
    }
    case "apply_patch": {
      const patch = (input as { patch?: unknown } | undefined)?.patch;
      const paths = typeof patch === "string" ? [...new Set(extractPatchPaths(patch))].sort() : [];
      return `apply_patch:${paths.length ? paths.join("|") : "*"}`;
    }
    case "spawn_agent": {
      const role = (input as { role?: unknown } | undefined)?.role;
      return `spawn_agent:${typeof role === "string" ? role : "*"}`;
    }
    default:
      return defaultPermissionKey(toolName, input);
  }
}

/** Pull the first executable token out of a shell command, skipping leading
 *  `VAR=value` env assignments. `FOO=bar BAZ=qux git push` → `git`. */
export function firstCommandToken(command: string): string {
  const trimmed = command.trim().replace(/^(?:[A-Za-z_][\w]*=\S*\s+)+/, "");
  const match = trimmed.match(/^[^\s|;&<>()`$\\]+/);
  return match?.[0] ?? "";
}

/** Commands that only observe the workspace — read state, never mutate.
 *  The bash tool's `requiresPermission` returns `false` for these so they
 *  never prompt. Anything not in this set falls through to the gate. */
const READ_ONLY_COMMANDS = new Set([
  // file system inspection
  "ls", "cat", "head", "tail", "pwd", "stat", "file", "wc", "du", "df",
  "tree", "readlink", "realpath", "basename", "dirname",
  // text search / inspection
  "grep", "egrep", "fgrep", "rg", "ag", "ack",
  // process / env inspection
  "ps", "top", "env", "printenv", "echo", "printf", "which", "whereis", "type",
  "id", "whoami", "hostname", "uname", "uptime", "date",
  // language / tool versions
  "node", "bun", "tsc", "deno", "python", "python3", "pip", "pip3",
  // ↑ many of these are read-only with --version / no args; we still need
  //   to require the gate for them when args could mutate. See looksLikeMutation.
]);

/** Commands where any invocation is presumed safe — version checks, listing,
 *  status queries. Subcommands that mutate are still gated. */
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "status", "log", "diff", "show", "branch", "remote", "blame",
  "ls-files", "ls-tree", "ls-remote", "describe", "rev-parse", "rev-list",
  "config", "tag", "shortlog", "name-rev", "for-each-ref", "reflog",
  "stash", "worktree", "submodule", "cat-file", "grep", "fsck", "count-objects",
]);

const READ_ONLY_FIND_FLAGS_BLOCKING = /\s-(?:delete|exec\b|execdir\b|ok\b|okdir\b|fls\b|fprint\b)/;

/** True when a command should consult the permission store; false to skip
 *  the gate entirely. Errs on the side of "ask" — only commands we can
 *  confidently classify as observation-only return false. */
export function looksLikeMutation(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return true;
  // Pipelines / sequences / substitutions / redirects — bail; treat as mutation.
  if (/[|;&<>`$()]/.test(trimmed)) return true;
  // Heredocs and process substitutions
  if (/<<\s*\w+|<\(|>\(/.test(trimmed)) return true;

  const token = firstCommandToken(trimmed);
  if (!token) return true;

  if (token === "git") {
    const restMatch = trimmed.match(/^git\s+([A-Za-z][\w-]*)/);
    const sub = restMatch?.[1];
    if (!sub) return false; // `git` alone prints help
    return !READ_ONLY_GIT_SUBCOMMANDS.has(sub);
  }

  if (token === "find") {
    // find without -delete/-exec/-execdir/-ok/-okdir/-fls/-fprint is observation
    return READ_ONLY_FIND_FLAGS_BLOCKING.test(` ${trimmed} `);
  }

  if (READ_ONLY_COMMANDS.has(token)) {
    // Tools with `--version`-style or input-only flags are observation; the
    // command word itself (node/bun/python) could still execute scripts, so
    // gate unless the only args look like flags / known read-only verbs.
    if (token === "node" || token === "bun" || token === "deno" || token === "tsc") {
      // Only safe if the only arg is --version / -v / --help
      const rest = trimmed.slice(token.length).trim();
      if (!rest) return false;
      if (/^(--version|-v|--help|-h)\b\s*$/.test(rest)) return false;
      return true;
    }
    if (token === "python" || token === "python3") {
      const rest = trimmed.slice(token.length).trim();
      return !/^(--version|-V|--help|-h)\b\s*$/.test(rest);
    }
    if (token === "pip" || token === "pip3") {
      const rest = trimmed.slice(token.length).trim();
      return !/^(list|show|search|--version|-V|--help|-h)\b/.test(rest);
    }
    return false;
  }

  return true;
}
