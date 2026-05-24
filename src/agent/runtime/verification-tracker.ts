import type { ToolResultData } from "glove-core/core";

/**
 * Patterns that count as "the agent ran a verification command."
 *
 * Matched against the raw `command` string of a successful `bash` tool
 * call. Conservative on purpose: we'd rather miss a real verification
 * (forcing the agent to be explicit) than mark an unrelated command as
 * verification and let unverified work pass through.
 *
 * Add new patterns here as new toolchains show up. The pattern must
 * appear somewhere in the command — anchoring is intentional only
 * where the command would be ambiguous otherwise.
 */
const VERIFICATION_PATTERNS: ReadonlyArray<RegExp> = [
  // Test runners
  /\b(bun|npm|pnpm|yarn|deno)(\s+run)?\s+test\b/,
  /\bbun\s+test\b/,
  /\bnpx\s+vitest\b/,
  /\bvitest(\s+run)?\b/,
  /\bjest\b/,
  /\bpytest\b/,
  /\bpython\s+-m\s+pytest\b/,
  /\bunittest\b/,
  /\bgo\s+test\b/,
  /\bcargo\s+test\b/,
  /\brspec\b/,
  /\bphpunit\b/,
  // Typecheckers
  /\b(bunx|npx|pnpx|yarn(\s+dlx)?)\s+tsc\b/,
  /\btsc\b(?!-)/, // bare `tsc` but not `tsconfig.json`
  /\bgo\s+vet\b/,
  /\bcargo\s+check\b/,
  /\bcargo\s+clippy\b/,
  /\bmypy\b/,
  /\bpyright\b/,
  // Linters / formatters (formatters check that nothing changed)
  /\b(bun|npm|pnpm|yarn)\s+(run\s+)?lint\b/,
  /\beslint\b/,
  /\bruff(\s+check)?\b/,
  /\bbiome\s+check\b/,
  /\brubocop\b/,
  /\bgolangci-lint\b/,
  // Build
  /\b(bun|npm|pnpm|yarn)\s+(run\s+)?build\b/,
  /\bcargo\s+build\b/,
  /\bgo\s+build\b/,
  // Skill-declared validators that crop up in this codebase
  /scripts\/office\/validate\.py\b/,
  /scripts\/accept_changes\.py\b/,
];

/** Tool calls whose successful completion records a file mutation. */
const MUTATING_TOOLS = new Set(["write", "edit", "apply_patch"]);

/** Tool calls that count as verification on success. */
const VERIFICATION_TOOLS = new Set<string>(); // bash handled specially

export interface FailedVerification {
  /** Pattern label (e.g. "bun test", "validate.py") or raw command head. */
  kind: string;
  /** Adapter-level message (usually "Command exited with code N"). */
  message: string;
  /** First line of the failing command, for context. */
  commandHead: string;
  at: number;
}

const FAILED_VERIFICATION_BUFFER = 5;

/**
 * Stateful tracker for "what the agent changed" vs "what the agent has
 * checked since." Reset is implicit: a successful verification clears the
 * pending list, since at that point the agent has seen whatever the
 * verification said about its changes.
 *
 * Failures are a different story. A test that errors is NOT a pass — the
 * agent should iterate (fix, try an alternative, or document the
 * environmental constraint) before declaring the work complete. We keep a
 * small ring of recent failed verifications so the session-state inject
 * can surface them. A subsequent successful verification clears the ring
 * (the agent worked through it); a new user turn also clears it (the
 * user has moved on).
 */
export class VerificationTracker {
  private mutations = new Map<string, number>();
  private lastVerifiedAt: number | null = null;
  private lastVerificationKind: string | null = null;
  private failedVerifications: FailedVerification[] = [];

  /** Mark a file as modified by a successful write/edit/apply_patch. */
  recordMutation(filePath: string, at: number = Date.now()): void {
    this.mutations.set(filePath, at);
  }

  /**
   * Mark that the agent ran a verification command and it passed. Clears
   * pending mutations AND the failed-verification ring — the agent worked
   * through whatever was broken.
   */
  recordVerification(kind: string, at: number = Date.now()): void {
    this.lastVerifiedAt = at;
    this.lastVerificationKind = kind;
    this.mutations.clear();
    this.failedVerifications = [];
  }

  /**
   * Mark a verification attempt that failed. Pending mutations are NOT
   * cleared — they still need a passing check. Stored in a bounded ring
   * so the session state can surface the most recent failures.
   */
  recordFailedVerification(kind: string, message: string, commandHead: string, at: number = Date.now()): void {
    this.failedVerifications.push({ kind, message, commandHead, at });
    if (this.failedVerifications.length > FAILED_VERIFICATION_BUFFER) {
      this.failedVerifications.splice(0, this.failedVerifications.length - FAILED_VERIFICATION_BUFFER);
    }
  }

  /**
   * Called when a new user message arrives — implicit signal that the
   * user has moved on from whatever the agent was deliberating about.
   */
  onUserTurn(): void {
    this.failedVerifications = [];
  }

  /** Wipe all state — used when starting a fresh session. */
  reset(): void {
    this.mutations.clear();
    this.lastVerifiedAt = null;
    this.lastVerificationKind = null;
    this.failedVerifications = [];
  }

  /** Inspect tracker state for session-state injection / UI. */
  status(): VerificationStatus {
    return {
      pendingFiles: [...this.mutations.keys()].sort(),
      lastVerifiedAt: this.lastVerifiedAt,
      lastVerificationKind: this.lastVerificationKind,
      failedVerifications: [...this.failedVerifications],
    };
  }

  /**
   * Feed a tool result through the tracker. Returns true when the call
   * was acted on (so callers can log it if useful). Designed to be
   * called from the subscriber's `tool_use_result` branch.
   *
   * Verification-pattern bash commands are recorded whether they pass or
   * fail — failures land in the failed-verification ring so the agent
   * has to iterate or explicitly document why it cannot.
   */
  observe(toolName: string, input: unknown, result: ToolResultData): boolean {
    if (toolName === "bash") {
      const command = readCommand(input);
      if (command && looksLikeVerification(command)) {
        const kind = matchedPatternFor(command) ?? firstToken(command);
        if (result.status === "success") {
          this.recordVerification(kind);
        } else {
          this.recordFailedVerification(
            kind,
            result.message ?? `tool result status: ${result.status}`,
            firstLine(command),
          );
        }
        return true;
      }
    }
    if (result.status !== "success") return false;
    if (MUTATING_TOOLS.has(toolName)) {
      const filePath = readPath(input);
      if (filePath) {
        this.recordMutation(filePath);
        return true;
      }
    }
    if (VERIFICATION_TOOLS.has(toolName)) {
      this.recordVerification(toolName);
      return true;
    }
    return false;
  }
}

export interface VerificationStatus {
  pendingFiles: string[];
  lastVerifiedAt: number | null;
  lastVerificationKind: string | null;
  /** Optional for back-compat with status objects produced before this field existed. */
  failedVerifications?: FailedVerification[];
}

/** Does this bash command look like a test/build/typecheck/lint run? */
export function looksLikeVerification(command: string): boolean {
  for (const pattern of VERIFICATION_PATTERNS) {
    if (pattern.test(command)) return true;
  }
  return false;
}

function matchedPatternFor(command: string): string | null {
  for (const pattern of VERIFICATION_PATTERNS) {
    const match = command.match(pattern);
    if (match) return match[0];
  }
  return null;
}

function readPath(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const candidates = ["path", "file_path", "filePath"];
  for (const key of candidates) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function readCommand(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const v = (input as Record<string, unknown>).command;
  return typeof v === "string" ? v : null;
}

function firstToken(command: string): string {
  return command.trim().split(/\s+/)[0] ?? "bash";
}

function firstLine(command: string): string {
  const line = command.trim().split("\n")[0] ?? "";
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}
