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

/**
 * Stateful tracker for "what the agent changed" vs "what the agent has
 * checked since." Reset is implicit: a successful verification clears the
 * pending list, since at that point the agent has seen whatever the
 * verification said about its changes. Failures still clear — they're not
 * a free pass, but the agent now has signal it must respond to.
 */
export class VerificationTracker {
  private mutations = new Map<string, number>();
  private lastVerifiedAt: number | null = null;
  private lastVerificationKind: string | null = null;

  /** Mark a file as modified by a successful write/edit/apply_patch. */
  recordMutation(filePath: string, at: number = Date.now()): void {
    this.mutations.set(filePath, at);
  }

  /**
   * Mark that the agent ran a verification command. Clears the pending
   * list — the agent has now seen the result and is responsible for
   * dealing with it.
   */
  recordVerification(kind: string, at: number = Date.now()): void {
    this.lastVerifiedAt = at;
    this.lastVerificationKind = kind;
    this.mutations.clear();
  }

  /** Wipe all state — used when starting a fresh session. */
  reset(): void {
    this.mutations.clear();
    this.lastVerifiedAt = null;
    this.lastVerificationKind = null;
  }

  /** Inspect tracker state for session-state injection / UI. */
  status(): VerificationStatus {
    return {
      pendingFiles: [...this.mutations.keys()].sort(),
      lastVerifiedAt: this.lastVerifiedAt,
      lastVerificationKind: this.lastVerificationKind,
    };
  }

  /**
   * Feed a tool result through the tracker. Returns true when the call
   * was acted on (so callers can log it if useful). Designed to be
   * called from the subscriber's `tool_use_result` branch.
   */
  observe(toolName: string, input: unknown, result: ToolResultData): boolean {
    if (result.status !== "success") return false;
    if (MUTATING_TOOLS.has(toolName)) {
      const filePath = readPath(input);
      if (filePath) {
        this.recordMutation(filePath);
        return true;
      }
    }
    if (toolName === "bash") {
      const command = readCommand(input);
      if (command && looksLikeVerification(command)) {
        this.recordVerification(matchedPatternFor(command) ?? "bash");
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
