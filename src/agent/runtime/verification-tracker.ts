import type { ToolResultData } from "glove-core/core";
import {
  type ClearSignal,
  MUTATING_TOOLS,
  commandSignals,
  firstLine,
  firstToken,
  looksLikeVerification,
  matchedPatternFor,
  readCommand,
  readEvaluatorRole,
  readPath,
} from "./verification-patterns.ts";
import { classifyPath, groupByCategory } from "./verification-categories.ts";

export { looksLikeVerification } from "./verification-patterns.ts";
export { classifyPath } from "./verification-categories.ts";

export interface FailedVerification {
  /** Pattern label (e.g. "bun test", "validate.py") or raw command head. */
  kind: string;
  /** Adapter-level message (usually "Command exited with code N"). */
  message: string;
  /** First line of the failing command, for context. */
  commandHead: string;
  at: number;
}

/** Signals from objective checks clear the failed-verification ring. */
const OBJECTIVE_SIGNALS: ReadonlySet<ClearSignal> = new Set(["command", "validator", "browser"]);

const FAILED_VERIFICATION_BUFFER = 5;

/**
 * Stateful tracker for "what the agent changed" vs "what it validated since."
 * Category aware: every mutated file is classified (code / web / document /
 * presentation / artifact — see verification-categories.ts) and clears only
 * when an action it accepts as evaluation occurs (tests clear code, a browser
 * drive clears web, re-read or an independent reviewer clears docs/decks/
 * artifacts). One pattern across all deliverables. Failures are tracked apart:
 * a check that errors is not a pass, so a bounded ring surfaces recent
 * failures until a passing objective check or a new user turn clears it.
 */
export class VerificationTracker {
  private mutations = new Map<string, number>();
  private lastVerifiedAt: number | null = null;
  private lastVerificationKind: string | null = null;
  private failedVerifications: FailedVerification[] = [];
  /** Re-reads of pending files whose category does NOT accept re-reading as
   * verification (code). Each one is a wasted loop iteration — past a couple,
   * the injected guidance flips to "stop and conclude" so a model that can't
   * run an objective check doesn't spiral re-reading the same files forever. */
  private futileReads = new Map<string, number>();

  /** Mark a file as modified by a successful write/edit/apply_patch. */
  recordMutation(filePath: string, at: number = Date.now()): void {
    this.mutations.set(filePath, at);
  }

  /**
   * Record a passing objective check (toolchain command, declared validator,
   * or browser drive). Clears matching pending files plus the failed ring.
   */
  recordPassingCheck(signals: ClearSignal[], kind: string, at: number = Date.now()): void {
    this.clearBySignals(signals, at, kind);
    this.failedVerifications = [];
    this.futileReads.clear();
  }

  /** Back-compat shorthand: a passing code toolchain command. */
  recordVerification(kind: string, at: number = Date.now()): void {
    this.recordPassingCheck(["command"], kind, at);
  }

  /**
   * Record a non-objective validation pass (reviewer/evaluator, or a visual
   * look via view_image). Clears category-matching files; never code/the ring.
   */
  recordReviewPass(
    kind = "reviewer review",
    signals: ClearSignal[] = ["reviewer"],
    at: number = Date.now(),
  ): void {
    this.clearBySignals(signals, at, kind);
  }

  /** Re-reading a produced artifact (self-review) clears just that file. */
  recordRereadPass(filePath: string, at: number = Date.now()): void {
    if (!this.mutations.has(filePath)) return;
    if (!classifyPath(filePath).clearedBy.has("reread")) {
      // Re-reading code is not verification — count the futile pass.
      this.futileReads.set(filePath, (this.futileReads.get(filePath) ?? 0) + 1);
      return;
    }
    this.mutations.delete(filePath);
    this.lastVerifiedAt = at;
    this.lastVerificationKind = "re-read artifact";
  }

  /** Remove every pending file whose category accepts one of `signals`. */
  private clearBySignals(signals: ClearSignal[], at: number, kind: string): void {
    for (const path of [...this.mutations.keys()]) {
      const cat = classifyPath(path);
      if (signals.some((s) => cat.clearedBy.has(s))) this.mutations.delete(path);
    }
    this.lastVerifiedAt = at;
    this.lastVerificationKind = kind;
  }

  /**
   * Mark a verification attempt that failed. Pending mutations are NOT
   * cleared — they still need a passing check.
   */
  recordFailedVerification(kind: string, message: string, commandHead: string, at: number = Date.now()): void {
    this.failedVerifications.push({ kind, message, commandHead, at });
    if (this.failedVerifications.length > FAILED_VERIFICATION_BUFFER) {
      this.failedVerifications.splice(0, this.failedVerifications.length - FAILED_VERIFICATION_BUFFER);
    }
  }

  /** New user message — the user has moved on from prior deliberation. */
  onUserTurn(): void {
    this.failedVerifications = [];
    this.futileReads.clear();
  }

  /** Wipe all state — used when starting a fresh session. */
  reset(): void {
    this.mutations.clear();
    this.lastVerifiedAt = null;
    this.lastVerificationKind = null;
    this.failedVerifications = [];
    this.futileReads.clear();
  }

  /** Inspect tracker state for session-state injection / UI. */
  status(): VerificationStatus {
    const pendingFiles = [...this.mutations.keys()].sort();
    return {
      pendingFiles,
      pendingByCategory: groupByCategory(pendingFiles),
      lastVerifiedAt: this.lastVerifiedAt,
      lastVerificationKind: this.lastVerificationKind,
      failedVerifications: [...this.failedVerifications],
      futileReadCount: [...this.futileReads.values()].reduce((n, c) => n + c, 0),
    };
  }

  /**
   * Feed a tool result through the tracker. Returns true when the call was
   * acted on. Designed to be called from the subscriber's `tool_use_result`
   * branch. See the class doc for the clearing model.
   */
  observe(toolName: string, input: unknown, result: ToolResultData): boolean {
    if (toolName === "bash") {
      const command = readCommand(input);
      if (command && looksLikeVerification(command)) {
        const kind = matchedPatternFor(command) ?? firstToken(command);
        if (result.status === "success") {
          this.recordPassingCheck(commandSignals(command), kind);
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
    // Re-reading a produced artifact is a self-review pass.
    if (toolName === "read") {
      const filePath = readPath(input);
      if (filePath && this.mutations.has(filePath)) {
        this.recordRereadPass(filePath);
        return true;
      }
    }
    // Looking at a screenshot/render is the visual check for web & decks.
    if (toolName === "view_image") {
      this.recordReviewPass("viewed image", ["visual"]);
      return true;
    }
    // Handing work to an independent reviewer/evaluator clears review-eligible
    // categories — the article's generator/evaluator split.
    if (toolName === "glove_invoke_subagent" || toolName === "spawn_agent") {
      const role = readEvaluatorRole(input);
      if (role) {
        this.recordReviewPass(`${role} review`);
        return true;
      }
    }
    return false;
  }
}

export interface VerificationStatus {
  pendingFiles: string[];
  /** Pending file paths grouped by deliverable category id. */
  pendingByCategory?: Record<string, string[]>;
  lastVerifiedAt: number | null;
  lastVerificationKind: string | null;
  /** Optional for back-compat with status objects produced before this field existed. */
  failedVerifications?: FailedVerification[];
  /** Re-reads of pending code files (which re-reading cannot clear). */
  futileReadCount?: number;
}
