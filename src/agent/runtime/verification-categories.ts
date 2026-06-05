/**
 * Deliverable-category registry: the single, extensible pattern for "what
 * does evaluation mean for this kind of output?"
 *
 * Every file the agent produces is classified into exactly one category.
 * Each category declares which *clear signals* count as a valid evaluation
 * of it (run the tests, drive a browser, run the declared validator, re-read
 * the artifact, hand it to an independent reviewer), plus the guidance shown
 * to the agent when work in that category is still unvalidated.
 *
 * Adding a new kind of deliverable is one entry in CATEGORIES — the tracker,
 * the completion guard, and the session-state injection all read from here.
 */

import { type ClearSignal, fileExt } from "./verification-patterns.ts";
import type { VerificationStatus } from "./verification-tracker.ts";

export interface DeliverableCategory {
  id: string;
  /** Display label used in agent-facing guidance. */
  label: string;
  /** Does a file path belong to this category? */
  match: (path: string) => boolean;
  /** Actions that count as validating this category. */
  clearedBy: ReadonlySet<ClearSignal>;
  /** Header for this category's block in the session-state injection. */
  header: string;
  /** How to validate this category — shown by the guard and session state. */
  steps: readonly string[];
}

const has = (...exts: string[]) => {
  const set = new Set(exts);
  return (path: string) => set.has(fileExt(path));
};

/**
 * Order matters: the first match wins, and `artifact` is the catch-all, so it
 * must stay last. More specific categories go first.
 */
export const CATEGORIES: readonly DeliverableCategory[] = [
  {
    id: "web",
    label: "Web / UI (something to be presented)",
    match: has(".html", ".htm", ".css", ".scss", ".sass", ".vue", ".svelte", ".astro"),
    clearedBy: new Set<ClearSignal>(["browser", "reviewer", "reread", "visual"]),
    header: "Unvalidated web/UI (serve, screenshot, and look at it before claiming completion):",
    steps: [
      "Serve or open the page, capture a screenshot (e.g. with playwright), then `view_image` it — actually look at it; do not claim a UI works from source alone.",
      "Check layout, responsive behavior, text overflow, interactive/empty/error states, and asset rendering on desktop and mobile widths.",
      "For substantial UI, get an independent visual review (`glove_invoke_subagent({ name: \"reviewer\" })` or spawn an `evaluator`).",
      "If you cannot drive a browser here, say so explicitly — name what's missing.",
    ],
  },
  {
    id: "presentation",
    label: "Presentation / slide deck",
    match: has(".pptx", ".ppt", ".key", ".odp"),
    clearedBy: new Set<ClearSignal>(["validator", "reviewer", "reread", "visual"]),
    header: "Unvalidated presentation (render, look at it, and review before claiming completion):",
    steps: [
      "Run the skill's validator if one exists (e.g. `scripts/office/validate.py`); a deck that opens is not the same as a good deck.",
      "Render the slides to images and `view_image` them — judge each: one clear message, no overflow off the canvas, consistent layout/typography, no placeholder/lorem content.",
      "For a substantial deck, get an independent reviewer/evaluator pass.",
    ],
  },
  {
    id: "document",
    label: "Document / report / data export",
    match: has(
      ".docx", ".doc", ".pdf", ".odt", ".rtf", ".epub",
      ".xlsx", ".xls", ".ods", ".csv", ".tsv", ".md", ".rst", ".txt",
    ),
    clearedBy: new Set<ClearSignal>(["validator", "reviewer", "reread"]),
    header: "Unvalidated deliverables (re-read and check against the request before claiming completion):",
    steps: [
      "Re-open the artifact you produced (read it back) and judge it against concrete criteria: does it fully answer the request, is the structure coherent, are sections complete (no placeholders/TODOs/lorem), is formatting clean, are facts/numbers internally consistent?",
      "If the skill declares a validator (e.g. `scripts/office/validate.py`), run it — a file that opens is not the same as a valid file.",
      "For a substantial deliverable, hand it to an independent reviewer/evaluator (`glove_invoke_subagent({ name: \"reviewer\" })`).",
    ],
  },
  {
    id: "code",
    label: "Code",
    match: () => true, // see classifyPath: code is the default before `artifact`
    clearedBy: new Set<ClearSignal>(["command"]),
    header: "Unverified mutations (run a test/build/typecheck before claiming completion):",
    steps: [
      "Run the typecheck (e.g. `tsc --noEmit`).",
      "Run the test suite (e.g. `bun test`) covering the changed files.",
      "Run the linter if configured.",
    ],
  },
];

const ARTIFACT: DeliverableCategory = {
  id: "artifact",
  label: "Artifact",
  match: () => true,
  clearedBy: new Set<ClearSignal>(["reviewer", "reread"]),
  header: "Unvalidated artifacts (inspect before claiming completion):",
  steps: [
    "Re-open/inspect the artifact and confirm it matches what was requested.",
    "For anything substantial, get an independent reviewer/evaluator pass.",
  ],
};

const KNOWN_CODE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java",
  ".rb", ".php", ".c", ".cc", ".cpp", ".h", ".hpp", ".cs", ".swift", ".kt",
  ".scala", ".sh", ".bash", ".sql", ".json", ".yaml", ".yml", ".toml",
]);

/** Classify a file path into exactly one deliverable category. */
export function classifyPath(path: string): DeliverableCategory {
  for (const cat of CATEGORIES) {
    if (cat.id === "code") continue; // handled explicitly below
    if (cat.match(path)) return cat;
  }
  if (KNOWN_CODE_EXT.has(fileExt(path))) return CATEGORIES.find((c) => c.id === "code")!;
  return ARTIFACT;
}

/** Look up a category by id (falls back to the artifact catch-all). */
export function categoryById(id: string): DeliverableCategory {
  return CATEGORIES.find((c) => c.id === id) ?? ARTIFACT;
}

/** Group pending file paths by category id, preserving registry order. */
export function groupByCategory(paths: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const path of paths) {
    const id = classifyPath(path).id;
    (out[id] ??= []).push(path);
  }
  return out;
}

/** Distinct category ids present in a pending-by-category map, registry order. */
function presentIds(pendingByCategory: Record<string, string[]>): string[] {
  const order = [...CATEGORIES.map((c) => c.id), ARTIFACT.id];
  return order.filter((id) => (pendingByCategory[id]?.length ?? 0) > 0);
}

/**
 * Build the completion-guard enforcement prompt for whatever categories are
 * pending. Generalizes across code, web, documents, slides, and artifacts.
 */
export function enforcementPrompt(
  pendingByCategory: Record<string, string[]>,
  hasFailed: boolean,
): string {
  const ids = presentIds(pendingByCategory);
  const lines: string[] = [
    "[internal verification enforcement]",
    "You are about to declare the work complete, but there are unvalidated",
    "changes. Producing output is not the same as confirming it is good.",
    "Before claiming completion, run the right evaluation for each kind below:",
    "",
  ];
  for (const id of ids) {
    const cat = categoryById(id);
    lines.push(`${cat.label}:`);
    for (const step of cat.steps) lines.push(`- ${step}`);
    lines.push("");
  }
  if (hasFailed) {
    lines.push("A recent check FAILED — that is a continuation signal, not an exit: diagnose, fix, and re-run.");
    lines.push("");
  }
  lines.push("Only declare completion once each item above passes. If a check");
  lines.push("genuinely cannot run here, say so explicitly and name what is needed.");
  return lines.join("\n");
}

/** Render the pending-mutations portion of the session-state injection. */
export function renderPendingBlocks(status: VerificationStatus): string {
  const byCat = status.pendingByCategory ?? groupByCategory(status.pendingFiles);
  const blocks: string[] = [];
  for (const id of presentIds(byCat)) {
    const cat = categoryById(id);
    const files = byCat[id] ?? [];
    const lines = [cat.header];
    for (const file of files.slice(0, 20)) lines.push(`- ${file}`);
    if (files.length > 20) lines.push(`- ...and ${files.length - 20} more`);
    if (id === "code") lines.push(codeVerificationNote(status));
    else for (const step of cat.steps) lines.push(step);
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

function codeVerificationNote(status: VerificationStatus): string {
  return status.lastVerificationKind
    ? `Last verification observed: ${status.lastVerificationKind} — but it predates the changes above.`
    : "No verification command has run in this session yet.";
}
