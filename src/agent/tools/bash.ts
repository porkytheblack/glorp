import { z } from "zod";
import { spawn } from "node:child_process";
import type { DisplayManagerAdapter } from "glove-core/display-manager";
import type { SummaryTool } from "./summaries.ts";
import { compactText, lineCount } from "./summaries.ts";
import { looksLikeMutation } from "../permission-key.ts";

const MAX_OUTPUT_BYTES_PER_STREAM = 64 * 1024;
const OUTPUT_HEAD_BYTES = 48 * 1024;
const OUTPUT_TAIL_BYTES = 16 * 1024;

interface BashSummaryArgs {
  command: string;
  description: string;
  exitCode: number;
  timedOut: boolean;
  stdoutLines: number;
  stderrLines: number;
  stdoutPreview: string;
  stderrPreview: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

/**
 * Catastrophic shapes — refused outright, no override. These are commands
 * with no legitimate use inside a workspace shell.
 */
const HARD_BLOCK_PATTERNS = [
  // rm -rf / and variants (rm -rf /, rm -rf /*, rm -fr /, rm -Rf /, etc.)
  /\brm\s+(?:-[a-zA-Z]*[rRfF][a-zA-Z]*\s+)+\/(\s|$|\*)/,
  /:\(\)\s*\{[^}]*\}\s*;\s*:/, // classic fork bomb
  /\bmkfs(\.[a-z0-9]+)?\b/,
  /\bdd\s+[^|;&]*\bof=\/dev\/(sd[a-z]|nvme\d+n\d+|vd[a-z]|xvd[a-z])/,
  />+\s*\/dev\/(sd[a-z]|nvme\d+n\d+|vd[a-z]|xvd[a-z])/,
];

/**
 * Risky shapes — the tool prompts the user every time. Never cached, even
 * after a general "always allow bash" grant. The reason string surfaces in
 * the confirmation modal so the user sees why we're asking.
 *
 * "Global" patterns (install/uninstall/update of system-wide packages,
 * homebrew, system config changes) are in here on purpose: they mutate
 * state outside the workspace and a coding agent should never run them
 * autonomously. The user can still approve with a single click — we just
 * never assume.
 */
const CONFIRM_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Destructive filesystem / privilege
  { pattern: /\brm\s+(?:-[a-zA-Z]*[rRfF][a-zA-Z]*\s+)/, reason: "recursive/force delete" },
  { pattern: /\brm\s+[^\n]*\s\.(\s|$)/, reason: "deletes current directory" },
  { pattern: /\brm\s+[^\n]*\s~(\s|\/|$)/, reason: "deletes home directory" },
  { pattern: /\bsudo\b/, reason: "elevates privileges with sudo" },
  { pattern: /\bchmod\s+-R\b/, reason: "recursive chmod" },
  { pattern: /\bchown\s+-R\b/, reason: "recursive chown" },

  // Destructive git
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: "git reset --hard discards uncommitted work" },
  { pattern: /\bgit\s+clean\s+-[a-zA-Z]*[fFxXdD]/, reason: "git clean removes untracked files" },
  { pattern: /\bgit\s+push\b[^|;&]*\s(?:--force\b|-f\b)/, reason: "git force push rewrites remote history" },
  { pattern: /\bgit\s+branch\s+-D\b/, reason: "force-deletes a branch" },

  // Pipe-to-shell installers
  { pattern: /\b(curl|wget)\b[^|;&]*\|\s*(bash|sh|zsh|fish)\b/, reason: "executes downloaded script" },

  // Node/JS global installs — npm, pnpm, yarn, bun
  { pattern: /\bnpm\s+(?:i|install|add)\b[^|;&]*\s(?:-g\b|--global\b)/, reason: "installs an npm package globally" },
  { pattern: /\bnpm\s+(?:uninstall|remove|rm|un|unlink)\b[^|;&]*\s(?:-g\b|--global\b)/, reason: "removes a global npm package" },
  { pattern: /\bpnpm\s+(?:add|i|install)\b[^|;&]*\s(?:-g\b|--global\b)/, reason: "installs a pnpm package globally" },
  { pattern: /\byarn\s+global\b/, reason: "yarn global install/remove (system-wide)" },
  { pattern: /\bbun\s+(?:add|install|i)\b[^|;&]*\s(?:-g\b|--global\b)/, reason: "installs a bun package globally" },

  // Python global installs
  { pattern: /\bpip3?\s+install\b[^|;&]*\s--user\b/, reason: "pip install --user (writes to your home, not the workspace)" },
  { pattern: /\bpipx\s+install\b/, reason: "pipx install (system-wide CLI install)" },
  { pattern: /\buv\s+(?:tool\s+)?install\b/, reason: "uv tool install (system-wide CLI install)" },

  // Other language ecosystems
  { pattern: /\bcargo\s+install\b/, reason: "cargo install (writes a binary to ~/.cargo/bin)" },
  { pattern: /\bgo\s+install\b/, reason: "go install (writes a binary to $GOBIN)" },
  { pattern: /\bgem\s+install\b(?![^|;&]*\s--user-install\b)/, reason: "gem install (system-wide)" },

  // macOS / Linux package managers
  { pattern: /\bbrew\s+(?:install|uninstall|update|upgrade|reinstall|tap|untap|cask)\b/, reason: "homebrew package management" },
  { pattern: /\b(?:apt|apt-get|aptitude)\s+(?:install|remove|purge|update|upgrade|full-upgrade)\b/, reason: "apt package management" },
  { pattern: /\bdnf\s+(?:install|remove|update|upgrade)\b/, reason: "dnf package management" },
  { pattern: /\byum\s+(?:install|remove|update|upgrade)\b/, reason: "yum package management" },
  { pattern: /\bpacman\s+-S/, reason: "pacman package management" },
  { pattern: /\bzypper\s+(?:install|remove|update|upgrade)\b/, reason: "zypper package management" },
  { pattern: /\bsnap\s+(?:install|remove|refresh)\b/, reason: "snap package management" },
  { pattern: /\bport\s+(?:install|uninstall|upgrade)\b/, reason: "MacPorts package management" },
  { pattern: /\bsoftwareupdate\b/, reason: "macOS system update tool" },

  // Global config / process control
  { pattern: /\bgit\s+config\s+--(?:global|system)\b/, reason: "modifies your global/system git config" },
  { pattern: /\bnpm\s+config\s+set\b[^|;&]*\s(?:-g\b|--global\b)/, reason: "modifies your global npm config" },
  { pattern: /\b(?:systemctl|launchctl|service)\s+(?:start|stop|restart|enable|disable|load|unload)\b/, reason: "starts/stops a system service" },
];

function hardBlockReason(cmd: string): string | null {
  for (const p of HARD_BLOCK_PATTERNS) {
    if (p.test(cmd)) return `Command matches a destructive pattern (${p}). Refusing.`;
  }
  return null;
}

function confirmReason(cmd: string): string | null {
  for (const { pattern, reason } of CONFIRM_PATTERNS) {
    if (pattern.test(cmd)) return reason;
  }
  return null;
}

/**
 * Push a one-shot confirmation slot for a destructive bash command. The
 * decision is intentionally not cached: every matching command re-prompts,
 * regardless of any prior "always allow bash" grant. Falsy `display` (test
 * harnesses with stub objects) is treated as no consent — fail closed.
 */
async function askDestructiveConfirm(
  display: DisplayManagerAdapter | undefined,
  command: string,
  reason: string,
): Promise<boolean> {
  if (!display?.pushAndWait) return false;
  const message =
    `Glorp wants to run a destructive shell command (${reason}):\n\n` +
    `  ${command}\n\n` +
    `Allow this one time? (not remembered)`;
  try {
    const result = await display.pushAndWait<unknown, unknown>({
      renderer: "confirm",
      input: { message, yesLabel: "run once", noLabel: "abort", danger: true },
    });
    return Boolean(result);
  } catch {
    return false;
  }
}

function cleanTerminalOutput(text: string): string {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[=>]/g, "")
    .split(/\r|\n/)
    .filter((line, index, lines) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      return index === lines.length - 1 || trimmed !== lines[index + 1]?.trim();
    })
    .join("\n");
}

function newlineCount(text: string): number {
  return (text.match(/\n/g) ?? []).length;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf-8");
}

function takeFirstBytes(text: string, bytes: number): string {
  const buf = Buffer.from(text, "utf-8");
  return buf.length <= bytes ? text : buf.subarray(0, bytes).toString("utf-8");
}

function takeLastBytes(text: string, bytes: number): string {
  const buf = Buffer.from(text, "utf-8");
  return buf.length <= bytes ? text : buf.subarray(buf.length - bytes).toString("utf-8");
}

function makeStreamCapture(label: "stdout" | "stderr") {
  let full = "";
  let head = "";
  let tail = "";
  let totalBytes = 0;
  let totalNewlines = 0;
  let truncated = false;

  return {
    push(buf: Buffer) {
      const text = buf.toString("utf-8");
      totalBytes += buf.length;
      totalNewlines += newlineCount(text);
      if (!truncated && totalBytes <= MAX_OUTPUT_BYTES_PER_STREAM) {
        full += text;
        return;
      }
      if (!truncated) {
        truncated = true;
        const combined = full + text;
        head = takeFirstBytes(combined, OUTPUT_HEAD_BYTES);
        tail = takeLastBytes(combined, OUTPUT_TAIL_BYTES);
        full = "";
        return;
      }
      tail = takeLastBytes(tail + text, OUTPUT_TAIL_BYTES);
    },
    value() {
      if (!truncated) return cleanTerminalOutput(full);
      const totalLines = totalNewlines + 1;
      const retainedLines = lineCount(head) + lineCount(tail);
      const omittedLines = Math.max(0, totalLines - retainedLines);
      return cleanTerminalOutput(
        `${head}\n... [${label} truncated: ${omittedLines} lines elided; ${totalBytes} bytes total, kept ${byteLength(head) + byteLength(tail)} bytes head+tail]\n${tail}`,
      );
    },
    truncated() {
      return truncated;
    },
  };
}

export function bashTool(workspace: string): SummaryTool<{
  command: string;
  description: string;
  timeout_ms?: number;
}, BashSummaryArgs> {
  return {
    name: "bash",
    description:
      "Run a shell command in the workspace via bash -c. Returns combined stdout+stderr + exit code. " +
      "Use dedicated tools (read/write/edit/grep/glob) when one applies. " +
      "Always include `description` so the user sees what you're doing.",
    // Skip the permission prompt for commands we can confidently classify as
    // observation-only (ls, cat, git status/log/diff, find without -exec, …).
    // Everything else (or anything with a pipe, redirect, or substitution)
    // still runs through the gate. The store keys grants by first command
    // token, so "always allow bash:git" doesn't open the door to "rm".
    requiresPermission: (input) => looksLikeMutation(input.command),
    inputSchema: z.object({
      command: z.string().describe("Shell command to run"),
      description: z.string().describe("One-sentence active-voice summary of what this command does"),
      timeout_ms: z
        .number()
        .int()
        .min(1000)
        .max(600_000)
        .optional()
        .describe("Timeout in ms (default 120000)"),
    }),
    async do(input, display, _glove, signal) {
      const hard = hardBlockReason(input.command);
      if (hard) {
        return { status: "error", data: null, message: hard };
      }
      const needsConfirm = confirmReason(input.command);
      if (needsConfirm) {
        const allowed = await askDestructiveConfirm(display, input.command, needsConfirm);
        if (!allowed) {
          return {
            status: "error",
            data: null,
            message: `User declined destructive command (${needsConfirm}).`,
          };
        }
      }
      const timeout = input.timeout_ms ?? 120_000;
      const result = await new Promise<{
        exitCode: number;
        stdout: string;
        stderr: string;
        timedOut: boolean;
      }>((resolve) => {
        const start = Date.now();
        const child = spawn("bash", ["-c", input.command], {
          cwd: workspace,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const stdoutCapture = makeStreamCapture("stdout");
        const stderrCapture = makeStreamCapture("stderr");
        child.stdout.on("data", (buf: Buffer) => stdoutCapture.push(buf));
        child.stderr.on("data", (buf: Buffer) => stderrCapture.push(buf));
        let killed = false;
        const sigkillTimer: { ref: NodeJS.Timeout | null } = { ref: null };
        const escalate = () => {
          if (killed) return;
          killed = true;
          try {
            child.kill("SIGTERM");
          } catch {}
          sigkillTimer.ref = setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {}
          }, 2000);
        };
        const timer = setTimeout(escalate, timeout);
        const onAbort = () => escalate();
        signal?.addEventListener("abort", onAbort, { once: true });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (sigkillTimer.ref) clearTimeout(sigkillTimer.ref);
          signal?.removeEventListener("abort", onAbort);
          const timedOut = killed && Date.now() - start >= timeout - 50;
          resolve({
            exitCode: code ?? -1,
            stdout: stdoutCapture.value(),
            stderr: stderrCapture.value(),
            timedOut,
          });
        });
      });
      const combined = [
        result.stdout && `stdout:\n${result.stdout}`,
        result.stderr && `stderr:\n${result.stderr}`,
        `exit_code: ${result.exitCode}`,
      ]
        .filter(Boolean)
        .join("\n");
      if (result.exitCode === 0) {
        return {
          status: "success",
          data: combined || "(no output)",
          generateSummaryArgs: {
            command: input.command,
            description: input.description,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            stdoutLines: lineCount(result.stdout),
            stderrLines: lineCount(result.stderr),
            stdoutPreview: compactText(result.stdout, 12, 2000),
            stderrPreview: compactText(result.stderr, 8, 1200),
            stdoutTruncated: result.stdout.includes("[stdout truncated"),
            stderrTruncated: result.stderr.includes("[stderr truncated"),
          } satisfies BashSummaryArgs,
          renderData: { command: input.command, description: input.description, exitCode: 0 },
        };
      }
      return {
        status: "error",
        data: combined,
        message: result.timedOut
          ? `Command timed out after ${timeout}ms`
          : `Command exited with code ${result.exitCode}`,
        generateSummaryArgs: {
          command: input.command,
          description: input.description,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdoutLines: lineCount(result.stdout),
          stderrLines: lineCount(result.stderr),
          stdoutPreview: compactText(result.stdout, 12, 2000),
          stderrPreview: compactText(result.stderr, 8, 1200),
          stdoutTruncated: result.stdout.includes("[stdout truncated"),
          stderrTruncated: result.stderr.includes("[stderr truncated"),
        } satisfies BashSummaryArgs,
        renderData: {
          command: input.command,
          description: input.description,
          exitCode: result.exitCode,
        },
      };
    },
    generateToolSummary: async (args) => {
      const a = args as BashSummaryArgs;
      const chunks = [
        `Ran: ${a.description}`,
        `Command: ${a.command}`,
        `Exit code: ${a.exitCode}${a.timedOut ? " (timed out)" : ""}`,
        `stdout: ${a.stdoutLines} line${a.stdoutLines === 1 ? "" : "s"}${
          a.stdoutTruncated ? " (truncated)" : ""
        }`,
        a.stdoutPreview ? `stdout preview:\n${a.stdoutPreview}` : "",
        `stderr: ${a.stderrLines} line${a.stderrLines === 1 ? "" : "s"}${
          a.stderrTruncated ? " (truncated)" : ""
        }`,
        a.stderrPreview ? `stderr preview:\n${a.stderrPreview}` : "",
        "Full prior command output omitted.",
      ].filter(Boolean);
      return chunks.join("\n");
    },
  };
}
