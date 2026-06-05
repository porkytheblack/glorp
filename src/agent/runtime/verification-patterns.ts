/**
 * Pure pattern helpers for the verification tracker. Extracted so the
 * tracker stays focused on state transitions and to keep both files under
 * the project's readability ceiling.
 *
 * Two modalities are recognised:
 *  - CODE work, verified by running a toolchain command (test/typecheck/
 *    lint/build). See VERIFICATION_PATTERNS.
 *  - DOCUMENT/artifact deliverables (.docx, .pptx, .pdf, …), which have no
 *    universal "run the tests" command. Those are verified by re-reading the
 *    artifact, running a declared validator, or handing it to an independent
 *    evaluator/reviewer. See isDocumentPath.
 */

/**
 * Patterns that count as "the agent ran a code verification command."
 * Conservative on purpose: better to miss a real verification (forcing the
 * agent to be explicit) than to mark an unrelated command as verification.
 */
export const VERIFICATION_PATTERNS: ReadonlyArray<RegExp> = [
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

/**
 * Extensions that mark a file as a document/artifact deliverable rather
 * than source code. These have no toolchain "test" — they are checked by
 * re-reading, a declared validator, or an independent reviewer pass.
 */
const DOCUMENT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls",
  ".pdf", ".odt", ".odp", ".ods", ".rtf", ".epub", ".csv",
]);

/** Tool calls whose successful completion records a file mutation. */
export const MUTATING_TOOLS: ReadonlySet<string> = new Set(["write", "edit", "apply_patch"]);

/** Subagent roles that count as an independent evaluation of a deliverable. */
const EVALUATOR_ROLES: ReadonlySet<string> = new Set(["reviewer", "evaluator"]);

/** Does this bash command look like a test/build/typecheck/lint run? */
export function looksLikeVerification(command: string): boolean {
  for (const pattern of VERIFICATION_PATTERNS) {
    if (pattern.test(command)) return true;
  }
  return false;
}

/** Is this path a document/artifact deliverable (vs. source code)? */
export function isDocumentPath(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return false;
  return DOCUMENT_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}

/** Label for the matched verification pattern, or null. */
export function matchedPatternFor(command: string): string | null {
  for (const pattern of VERIFICATION_PATTERNS) {
    const match = command.match(pattern);
    if (match) return match[0];
  }
  return null;
}

/** Read a file path from a tool input shape, trying common key names. */
export function readPath(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  for (const key of ["path", "file_path", "filePath"]) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

/** Read the `command` field from a bash tool input. */
export function readCommand(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const v = (input as Record<string, unknown>).command;
  return typeof v === "string" ? v : null;
}

/**
 * If a subagent/spawn tool input names an evaluator-style role, return it.
 * `glove_invoke_subagent` uses `name`; `spawn_agent` uses `role`.
 */
export function readEvaluatorRole(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  for (const key of ["name", "role"]) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === "string" && EVALUATOR_ROLES.has(v.toLowerCase())) return v.toLowerCase();
  }
  return null;
}

export function firstToken(command: string): string {
  return command.trim().split(/\s+/)[0] ?? "bash";
}

export function firstLine(command: string): string {
  const line = command.trim().split("\n")[0] ?? "";
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}
