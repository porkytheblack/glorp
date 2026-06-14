/**
 * Workspace enforcement for shell commands. Three severity tiers:
 *   "block"   — refused outright, no override possible
 *   "confirm" — one-shot user prompt every time, never cached
 *   null      — allowed (subject to the normal permission gate)
 *
 * Policy: anything that mutates state OUTSIDE the workspace is blocked.
 * Anything destructive WITHIN the workspace is confirmed.
 */
import { commandEscapesWorkspace } from "./fs-shared.ts";

export interface CommandViolation {
  severity: "block" | "confirm";
  reason: string;
}

/**
 * Where the command runs. A sandboxed Garage worker lives in a disposable,
 * per-session container, so the workspace-confinement heuristic — a safety net
 * for a LOCAL machine whose filesystem the agent shares — only false-positives
 * there (it hard-blocks routine `/tmp` scratch, reads of `/usr`, an absolute
 * path merely mentioned in an `echo` string, etc.). The container itself is the
 * isolation boundary, so confinement is skipped when `sandboxed`.
 */
export interface GuardOptions {
  sandboxed?: boolean;
}

export function guardCommand(cmd: string, workspace: string, opts: GuardOptions = {}): CommandViolation | null {
  const b = blockReason(cmd, workspace, opts);
  if (b) return { severity: "block", reason: b };
  const c = confirmReason(cmd);
  if (c) return { severity: "confirm", reason: c };
  return null;
}

// ── Hard blocks ─────────────────────────────────────────────────────
// No override. The agent has zero legitimate reason to run these.

const CATASTROPHIC: RegExp[] = [
  /\brm\s+(?:-[a-zA-Z]*[rRfF][a-zA-Z]*\s+)+\/(\s|$|\*)/,
  /:\(\)\s*\{[^}]*\}\s*;\s*:/,
  /\bmkfs(\.[a-z0-9]+)?\b/,
  /\bdd\s+[^|;&]*\bof=\/dev\/(sd[a-z]|nvme\d+n\d+|vd[a-z]|xvd[a-z])/,
  />+\s*\/dev\/(sd[a-z]|nvme\d+n\d+|vd[a-z]|xvd[a-z])/,
];

const GLOBAL_INSTALL: Array<{ pattern: RegExp; reason: string }> = [
  // Node/JS
  { pattern: /\bnpm\s+(?:i|install|add)\b[^|;&]*\s(?:-g\b|--global\b)/, reason: "npm global install" },
  { pattern: /\bnpm\s+(?:uninstall|remove|rm|un|unlink)\b[^|;&]*\s(?:-g\b|--global\b)/, reason: "npm global uninstall" },
  { pattern: /\bpnpm\s+(?:add|i|install)\b[^|;&]*\s(?:-g\b|--global\b)/, reason: "pnpm global install" },
  { pattern: /\byarn\s+global\b/, reason: "yarn global install" },
  { pattern: /\bbun\s+(?:add|install|i)\b[^|;&]*\s(?:-g\b|--global\b)/, reason: "bun global install" },
  // Python
  { pattern: /\bpip3?\s+install\b[^|;&]*\s--user\b/, reason: "pip --user install" },
  { pattern: /\bpipx\s+install\b/, reason: "pipx install (system-wide)" },
  { pattern: /\buv\s+(?:tool\s+)?install\b/, reason: "uv tool install (system-wide)" },
  // Rust / Go / Ruby
  { pattern: /\bcargo\s+install\b/, reason: "cargo install (writes to ~/.cargo/bin)" },
  { pattern: /\bgo\s+install\b/, reason: "go install (writes to $GOBIN)" },
  { pattern: /\bgem\s+install\b(?![^|;&]*\s--user-install\b)/, reason: "gem install (system-wide)" },
  // OS package managers
  { pattern: /\bbrew\s+(?:install|uninstall|update|upgrade|reinstall|tap|untap|cask)\b/, reason: "homebrew package management" },
  { pattern: /\b(?:apt|apt-get|aptitude)\s+(?:install|remove|purge|update|upgrade|full-upgrade)\b/, reason: "apt package management" },
  { pattern: /\bdnf\s+(?:install|remove|update|upgrade)\b/, reason: "dnf package management" },
  { pattern: /\byum\s+(?:install|remove|update|upgrade)\b/, reason: "yum package management" },
  { pattern: /\bpacman\s+-S/, reason: "pacman package management" },
  { pattern: /\bzypper\s+(?:install|remove|update|upgrade)\b/, reason: "zypper package management" },
  { pattern: /\bsnap\s+(?:install|remove|refresh)\b/, reason: "snap package management" },
  { pattern: /\bport\s+(?:install|uninstall|upgrade)\b/, reason: "MacPorts package management" },
  { pattern: /\bsoftwareupdate\b/, reason: "macOS system update" },
];

const SYSTEM_SCOPE: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bsudo\b/, reason: "elevates privileges with sudo" },
  { pattern: /\bgit\s+config\s+--(?:global|system)\b/, reason: "modifies global/system git config" },
  { pattern: /\bnpm\s+config\s+set\b[^|;&]*\s(?:-g\b|--global\b)/, reason: "modifies global npm config" },
  { pattern: /\b(?:systemctl|launchctl|service)\s+(?:start|stop|restart|enable|disable|load|unload)\b/, reason: "controls a system service" },
  { pattern: /\b(curl|wget)\b[^|;&]*\|\s*(bash|sh|zsh|fish)\b/, reason: "pipe-to-shell installer" },
];

function blockReason(cmd: string, workspace: string, opts: GuardOptions = {}): string | null {
  // These protect the session/host wherever it runs, so they apply in a sandbox too.
  for (const p of CATASTROPHIC) {
    if (p.test(cmd)) return `Catastrophic pattern detected (${p}). Refusing.`;
  }
  for (const { pattern, reason } of GLOBAL_INSTALL) {
    if (pattern.test(cmd)) return `Blocked: ${reason}. Agents must not install packages globally.`;
  }
  for (const { pattern, reason } of SYSTEM_SCOPE) {
    if (pattern.test(cmd)) return `Blocked: ${reason}. Agents must not modify system state.`;
  }
  // Workspace confinement is a host-filesystem safety net; a sandboxed worker is
  // already isolated by its container, where this only false-positives.
  if (!opts.sandboxed) {
    const escape = commandEscapesWorkspace(cmd, workspace);
    if (escape) return `Blocked: ${escape}. Agents must stay inside the workspace.`;
  }
  return null;
}

// ── Confirm-only ────────────────────────────────────────────────────
// Risky within the workspace. One-shot prompt, never cached.

const CONFIRM: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(?:-[a-zA-Z]*[rRfF][a-zA-Z]*\s+)/, reason: "recursive/force delete" },
  { pattern: /\brm\s+[^\n]*\s\.(\s|$)/, reason: "deletes current directory" },
  { pattern: /\bchmod\s+-R\b/, reason: "recursive chmod" },
  { pattern: /\bchown\s+-R\b/, reason: "recursive chown" },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: "git reset --hard discards uncommitted work" },
  { pattern: /\bgit\s+clean\s+-[a-zA-Z]*[fFxXdD]/, reason: "git clean removes untracked files" },
  { pattern: /\bgit\s+push\b[^|;&]*\s(?:--force\b|-f\b)/, reason: "git force push rewrites remote history" },
  { pattern: /\bgit\s+branch\s+-D\b/, reason: "force-deletes a branch" },
];

function confirmReason(cmd: string): string | null {
  for (const { pattern, reason } of CONFIRM) {
    if (pattern.test(cmd)) return reason;
  }
  return null;
}

// ── Exports for testing ─────────────────────────────────────────────
export { blockReason as _blockReason, confirmReason as _confirmReason };
