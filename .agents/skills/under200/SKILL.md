---
name: under200
description: Enforce NASA-style "Power of Ten" software engineering discipline on any code being written or modified, with a hard guideline that no source file exceeds 200 lines so a reviewer can read it top-to-bottom in one editor screen without jumping around. Use this skill whenever writing new source files, refactoring existing ones, reviewing code, splitting modules, or setting up a new project — even if the user does not explicitly say "under 200" or "NASA". If the user mentions file length, file size, "this file is too long", complexity, readability, code-review friendliness, or asks to set up linters/formatters/CI, apply this skill. Also apply proactively whenever any source file being edited is approaching or exceeds 200 lines.
---

# under200

A discipline skill that adapts NASA's *Power of Ten* rules (Gerard J. Holzmann, JPL) into general-purpose software engineering practice. The central, non-negotiable rule is the 200-line file ceiling. Every other rule exists to make that ceiling achievable without smuggling complexity elsewhere.

## Why 200 lines

A reviewer should be able to open a file, scroll once, and have read the whole thing. Files longer than that force the reader into the *jump-around-and-hold-state-in-your-head* mode that hides bugs, defeats code review, and resists onboarding. 200 lines is roughly two editor screens at a comfortable font size — enough room for a real unit of code, short enough that nothing is hiding.

This is a *ceiling*, not a target. Most files should be much smaller. If a file is at 195 lines, it is already overdue for a split.

## The rules

Apply these in priority order. The earlier rules win when they conflict with later ones.

### 1. Files stay under 200 lines (hard ceiling)

- Count all lines including imports, blank lines, and comments. The reviewer has to scroll past them too.
- Generated files, lockfiles, fixtures, and migrations are exempt — they are not read top-to-bottom.
- When a file crosses 200 lines, **split it before adding the feature that pushed it over**, not after. Splitting under deadline pressure produces worse seams than splitting deliberately.
- Prefer splits along *meaning* (one concept per file), not along *line count* (don't just cut at line 200).

### 2. Functions stay under ~60 lines

One printed page. If a function does not fit on a screen, the reader cannot hold its control flow in working memory. Extract helpers — but extract along meaningful boundaries, not arbitrarily.

### 3. Control flow stays simple

- No `goto`. No `setjmp`/`longjmp` analogues (uncontrolled exception-as-control-flow).
- Recursion only when bounded by a known finite input (parsing a fixed-depth AST is fine; recursing over user input is not).
- Every loop must have a provable upper bound on iterations. `while (true)` is acceptable only with a clear exit invariant documented in code.

### 4. Validate at boundaries, trust internals

- Check the return value of every fallible call. If a return value is intentionally ignored, make that explicit (`_ = …` in Go, `void` cast in C, `# noqa` with rationale in Python).
- Validate inputs at system boundaries (HTTP handlers, CLI entry points, deserialization). Do **not** re-validate inside internal helpers — that is defensive bloat and inflates line counts.

### 5. Smallest possible scope

- Declare variables at the narrowest scope where they are used.
- Prefer module-private over package-public; package-public over global.
- No mutable globals unless the runtime forces them (and then document why).

### 6. Limit metaprogramming and indirection

- Preprocessor macros (C/C++), decorators that rewrite ASTs, runtime monkey-patching, and deeply nested generics all hide control flow from the reader. Use them only when the alternative is materially worse.
- Function pointers, callbacks, and dynamic dispatch are fine — but each layer of indirection costs the reader something. Spend the budget where it pays off.

### 7. Compile/lint clean

- All warnings enabled. Treat warnings as errors in CI.
- Static analyzers and linters configured and passing. If a rule fires, fix the code; do not blanket-disable the rule.

## When this skill triggers

Apply it whenever you are:

- Writing a new source file → start with the structure that will keep it under 200 lines.
- Editing an existing file → check the line count first. If it is over 150, plan the split before adding code.
- Reviewing code → flag any file over 200 lines and any function over 60.
- Setting up a new project, CI, or pre-commit config → configure the linter rules in the next section.
- Asked to "clean up" / "refactor" / "make this more readable" → the line ceiling is usually the fastest win.

## Linter enforcement

If the project has a linter, **configure it to enforce these rules**. A rule that lives only in a skill rots; a rule that fails CI does not. When adding a new linter rule to an existing codebase that violates it, use the linter's per-file ignore mechanism for the existing offenders rather than relaxing the global threshold — that way new code is held to the standard and old code surfaces as known debt.

Concrete rule mappings (use these exact rules when the corresponding linter is present):

- **ESLint / TypeScript**: `max-lines: ["error", { max: 200, skipBlankLines: false, skipComments: false }]`, `max-lines-per-function: ["error", 60]`, `complexity: ["error", 10]`, `max-depth: ["error", 4]`.
- **Biome**: `noExcessiveLinesPerFunction`, `noExcessiveCognitiveComplexity`. File-length cap is not built in — add a pre-commit check.
- **Ruff / Python**: select `PLR0915` (too-many-statements), `C901` (complexity), `PLR0912` (too-many-branches). For file length use a pre-commit hook (`check-added-large-files` is for bytes; file-line cap needs a custom hook).
- **Pylint**: `max-module-lines=200`, `max-line-length=…`, `max-args`, `max-locals`, `max-branches`.
- **golangci-lint**: enable `funlen` (lines: 60), `gocyclo` (min-complexity: 10), `lll`. File length: enable `filelength` linter or add a CI check.
- **Clippy / Rust**: `clippy::too_many_lines` (configure in `clippy.toml` with `too-many-lines-threshold = 60`), `clippy::cognitive_complexity`.
- **RuboCop**: `Metrics/ClassLength: Max: 200`, `Metrics/MethodLength: Max: 60`, `Metrics/CyclomaticComplexity`, `Metrics/AbcSize`.
- **SwiftLint**: `file_length: 200`, `function_body_length: 60`, `cyclomatic_complexity`.
- **ktlint / detekt**: detekt `LongMethod` (threshold 60), `LargeClass` (threshold 200), `ComplexMethod`.

If the project has **no linter**, add a minimal pre-commit hook that fails when any tracked source file exceeds 200 lines. A POSIX one-liner is enough:

```sh
git diff --cached --name-only --diff-filter=ACM \
  | grep -E '\.(ts|tsx|js|jsx|py|go|rs|rb|swift|kt|java|c|h|cpp)$' \
  | xargs -I{} sh -c 'lines=$(wc -l < "{}"); [ "$lines" -le 200 ] || { echo "{}: $lines lines (>200)"; exit 1; }'
```

Wire it into Husky, `pre-commit`, lefthook, or whatever the project already uses. Do not invent a new hook framework.

## How to apply during a task

1. **Before editing a file**, run `wc -l <file>`. If it is already ≥ 150 lines, plan how to split before adding code.
2. **After editing**, re-check. If you crossed 200, split now — do not defer.
3. **When splitting**, cut along the seam where coupling is weakest (one concept per file). If no such seam exists, the function/class is doing too much and needs decomposition first.
4. **If the user pushes back** on a split ("just add it here, it's fine"), surface the cost ("this file will be 240 lines after the change, which makes review harder") and let them override. The rule is a strong default, not a religion — but the override should be conscious.
5. **When configuring a new project**, add the linter rules from the table above in the same PR as the project scaffolding. Retrofitting limits later is painful.

## What this skill is *not*

- Not a style guide (indentation, naming, import order). Use the project's existing formatter for that.
- Not a substitute for tests, types, or review.
- Not a license to split files arbitrarily — a 50-line file that is half of a coherent concept is worse than a 220-line file that is whole. Split *meaning*, not *lines*.

## One-line summary

If a reviewer cannot read your file top-to-bottom in one scroll, the file is wrong — fix the file, and let the linter remember the rule so you don't have to.
