import type { ToolResultData } from "glove-core/core";
import {
  MUTATING_TOOLS,
  firstLine,
  firstToken,
  isDocumentPath,
  looksLikeVerification,
  matchedPatternFor,
  readCommand,
  readEvaluatorRole,
  readPath,
} from "./verification-patterns.ts";

export { looksLikeVerification, isDocumentPath } from "./verification-patterns.ts";

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
 * Two modalities are tracked together. CODE mutations clear only when a
 * toolchain command (test/typecheck/lint/build) passes. DOCUMENT/artifact
 * deliverables (.docx, .pptx, …) have no universal test, so they also clear
 * when the agent re-reads the artifact or hands it to an independent
 * reviewer/evaluator — the document analogue of "redo a validation check."
 *
 * Failures are a different story. A test that errors is NOT a pass — the
 * agent should iterate before declaring the work complete. We keep a small
 * ring of recent failed verifications so the session-state inject can
 * surface them. A subsequent successful verification clears the ring; a new
 * user turn also clears it (the user has moved on).
 */
export class VerificationTracker {
  private mutations = new Map<string, number>();
  /** Subset of `mutations` whose paths are document/artifact deliverables. */
  private docs = new Set<string>();
  private lastVerifiedAt: number | null = null;
  private lastVerificationKind: string | null = null;
  private failedVerifications: FailedVerification[] = [];

  /** Mark a file as modified by a successful write/edit/apply_patch. */
  recordMutation(filePath: string, at: number = Date.now()): void {
    this.mutations.set(filePath, at);
    if (isDocumentPath(filePath)) this.docs.add(filePath);
    else this.docs.delete(filePath);
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
    this.docs.clear();
    this.failedVerifications = [];
  }

  /**
   * Mark that a document deliverable was validated by re-reading it or by an
   * independent reviewer/evaluator pass. Clears only document mutations —
   * code still needs a real toolchain check. When `filePath` is given, only
   * that artifact clears; otherwise every pending document clears (a reviewer
   * judged the whole set).
   */
  recordDocumentReview(filePath?: string, kind = "document review", at: number = Date.now()): void {
    if (filePath) {
      if (!this.docs.has(filePath)) return;
      this.docs.delete(filePath);
      this.mutations.delete(filePath);
    } else {
      for (const path of this.docs) this.mutations.delete(path);
      this.docs.clear();
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
    this.docs.clear();
    this.lastVerifiedAt = null;
    this.lastVerificationKind = null;
    this.failedVerifications = [];
  }

  /** Inspect tracker state for session-state injection / UI. */
  status(): VerificationStatus {
    return {
      pendingFiles: [...this.mutations.keys()].sort(),
      pendingDocs: [...this.docs].sort(),
      lastVerifiedAt: this.lastVerifiedAt,
      lastVerificationKind: this.lastVerificationKind,
      failedVerifications: [...this.failedVerifications],
    };
  }

  /**
   * Feed a tool result through the tracker. Returns true when the call was
   * acted on. Designed to be called from the subscriber's `tool_use_result`
   * branch.
   *
   * Verification-pattern bash commands are recorded whether they pass or
   * fail. Re-reading a pending document, or invoking an evaluator/reviewer
   * subagent, counts as a document validation pass.
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
    // Re-reading a document the agent already produced is a self-review pass.
    if (toolName === "read") {
      const filePath = readPath(input);
      if (filePath && this.docs.has(filePath)) {
        this.recordDocumentReview(filePath, "re-read artifact");
        return true;
      }
    }
    // Handing the deliverable to an independent reviewer/evaluator clears the
    // whole pending-document set — the article's generator/evaluator split.
    if (toolName === "glove_invoke_subagent" || toolName === "spawn_agent") {
      const role = readEvaluatorRole(input);
      if (role && this.docs.size > 0) {
        this.recordDocumentReview(undefined, `${role} review`);
        return true;
      }
    }
    return false;
  }
}

export interface VerificationStatus {
  pendingFiles: string[];
  /** Subset of pendingFiles that are document/artifact deliverables. */
  pendingDocs?: string[];
  lastVerifiedAt: number | null;
  lastVerificationKind: string | null;
  /** Optional for back-compat with status objects produced before this field existed. */
  failedVerifications?: FailedVerification[];
}
