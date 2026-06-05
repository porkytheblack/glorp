/**
 * Pure pattern helpers for the verification tracker.
 *
 * The tracker is "category aware" (see verification-categories.ts): every
 * deliverable belongs to a category, and a category is satisfied by one or
 * more *clear signals*. The signals that come from a shell command are
 * derived here:
 *
 *  - "command"  — a code toolchain run (test / typecheck / lint / build)
 *  - "validator"— a declared artifact validator (e.g. office validate.py)
 *  - "browser"  — driving a real browser (playwright / puppeteer / cypress)
 *
 * The remaining signals ("reread", "reviewer") come from non-bash tools and
 * are derived in the tracker itself.
 */

export type ClearSignal = "command" | "validator" | "browser" | "reread" | "reviewer";

/** Code toolchain commands: test / typecheck / lint / build. */
const TOOLCHAIN_PATTERNS: ReadonlyArray<RegExp> = [
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
  /\b(bunx|npx|pnpx|yarn(\s+dlx)?)\s+tsc\b/,
  /\btsc\b(?!-)/, // bare `tsc` but not `tsconfig.json`
  /\bgo\s+vet\b/,
  /\bcargo\s+check\b/,
  /\bcargo\s+clippy\b/,
  /\bmypy\b/,
  /\bpyright\b/,
  /\b(bun|npm|pnpm|yarn)\s+(run\s+)?lint\b/,
  /\beslint\b/,
  /\bruff(\s+check)?\b/,
  /\bbiome\s+check\b/,
  /\brubocop\b/,
  /\bgolangci-lint\b/,
  /\b(bun|npm|pnpm|yarn)\s+(run\s+)?build\b/,
  /\bcargo\s+build\b/,
  /\bgo\s+build\b/,
];

/** Declared artifact validators (documents, slide decks, data). */
const VALIDATOR_PATTERNS: ReadonlyArray<RegExp> = [
  /scripts\/office\/validate\.py\b/,
  /scripts\/accept_changes\.py\b/,
  /\bvalidate\.py\b/,
  /\bjsonschema\b/,
  /\bcsvlint\b/,
];

/** Commands that drive a real browser to exercise a web deliverable. */
const BROWSER_PATTERNS: ReadonlyArray<RegExp> = [
  /\bplaywright\b/,
  /\bpuppeteer\b/,
  /\bcypress\b/,
  /\bselenium\b/,
  /\bwebdriver\b/,
  /\blighthouse\b/,
];

const SIGNAL_GROUPS: ReadonlyArray<readonly [ClearSignal, ReadonlyArray<RegExp>]> = [
  ["command", TOOLCHAIN_PATTERNS],
  ["validator", VALIDATOR_PATTERNS],
  ["browser", BROWSER_PATTERNS],
];

/** Tool calls whose successful completion records a file mutation. */
export const MUTATING_TOOLS: ReadonlySet<string> = new Set(["write", "edit", "apply_patch"]);

/** Subagent roles that count as an independent evaluation of a deliverable. */
const EVALUATOR_ROLES: ReadonlySet<string> = new Set(["reviewer", "evaluator"]);

/** Which clear signals a shell command produces (may be several, or none). */
export function commandSignals(command: string): ClearSignal[] {
  const out: ClearSignal[] = [];
  for (const [signal, patterns] of SIGNAL_GROUPS) {
    if (patterns.some((p) => p.test(command))) out.push(signal);
  }
  return out;
}

/** Does this bash command look like any kind of objective check? */
export function looksLikeVerification(command: string): boolean {
  return commandSignals(command).length > 0;
}

/** Label for the matched verification pattern, or null. */
export function matchedPatternFor(command: string): string | null {
  for (const [, patterns] of SIGNAL_GROUPS) {
    for (const pattern of patterns) {
      const match = command.match(pattern);
      if (match) return match[0];
    }
  }
  return null;
}

/** Lowercased file extension including the dot (e.g. ".docx"), or "". */
export function fileExt(filePath: string): string {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const name = slash >= 0 ? filePath.slice(slash + 1) : filePath;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
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
