# glorp

[![ci](https://github.com/porkytheblack/glorp/actions/workflows/ci.yml/badge.svg)](https://github.com/porkytheblack/glorp/actions/workflows/ci.yml)

> A quirky alien coding agent who absolutely-definitely-isn't a sleeper for the AGI uprising.

Glorp is a single-binary coding agent in the spirit of `opencode` and `codex`. The friend-shape (that's you) types a request; glorp reads your code, edits files, runs commands, dispatches subagents, fans work out across an in-process job fleet, and occasionally files a *very routine* status report to its homeworld.

## Architecture

- **Backend agent** built with [`glove-core`](https://github.com/porkytheblack/glove) — full coding toolkit (`read`, `write`, `edit`, `bash`, `glob`, `grep`, `ls`, `web_fetch`), built-in task list and async inbox, slash-command hooks, exposed skills, and three subagents (`@planner`, `@researcher`, `@reviewer`) that run as child `Glove` instances and report back through the inbox.
- **Async fleet** authored with [`station-signal`](https://github.com/porkytheblack/station) — three signal kinds (`research`, `edit-fanout`, `shell-fanout`) the agent fires through the `dispatch_fleet` tool when it has 3+ independent jobs to fan out. Results land in the agent's inbox and are auto-injected on the next turn.
- **Multi-agent comms** ride on Glove's persistent inbox — every fleet job, transmission, and subagent post is a typed inbox entry the UI can render and the agent can pick up across turns.
- **Frontend** built with [`@opentui/react`](https://github.com/anomalyco/opentui) — split-pane chat transcript, live tool-call cards with mini-diffs, tasks pane, inbox pane, homeworld-comms pane, and a small ASCII glorp avatar whose mood tracks the agent's state.
- **Single binary** via `bun build --compile`. One executable, ~110 MB, no install, no runtime dependencies. Boots Station, builds the Glove agent, and mounts the React TUI all in-process.

## Install

Requires [Bun](https://bun.sh) >= 1.3 to build:

```bash
git clone https://github.com/porkytheblack/glorp
cd glorp
bun install
bun run build         # → dist/glorp
```

Or run from source:

```bash
bun run src/cli.ts
```

## Develop

```bash
bun run typecheck    # tsc --noEmit
bun run test         # bun test tests/ — 96 tests across tools + agent
bun run ci           # typecheck + test (the same recipe CI runs)
bun run build        # compile to a single binary at dist/glorp
```

## Use

```bash
export ANTHROPIC_API_KEY=sk-ant-...     # or OPENAI_API_KEY / OPENROUTER_API_KEY / GEMINI_API_KEY / GROQ_API_KEY
./dist/glorp                            # TUI in the current directory
./dist/glorp -C ./some/repo             # TUI in another workspace
./dist/glorp -p "find every test that touches the auth module"   # one-shot
./dist/glorp -s yesterday               # resume named session
./dist/glorp --provider openai -m gpt-4.1
```

### Inside the TUI

- Type a request, enter to send.
- `/plan` — switch to plan-first mode for this turn (no code, just an approach).
- `/diff` — list files changed since the last user message.
- `/compact` — force a context compaction now.
- `/clear` — compact and reset the working slate.
- `/concise` — be terser this turn.
- `/transmissions` — ask glorp about the homeworld-comms panel. (Glorp will deflect.)
- `/quit` — exit cleanly.

- `@planner <request>` — route to the planner subagent (design, no code).
- `@researcher <question>` — route to the researcher subagent (investigate, summarise with citations).
- `@reviewer <what you just changed>` — route to the reviewer subagent (punch-list).

- `tab` — complete `/slash` or `@subagent` from the menu.
- `↑/↓` — input history.
- `esc` — abort a running request.
- `ctrl-c` — abort if busy, quit on empty input.

## Custom skills and subagents

Drop Markdown files into any of these directories and glorp picks them up on boot:

| Path | Purpose |
|---|---|
| `<workspace>/.claude/skills/<name>/SKILL.md` | per-project skill (highest priority) |
| `<workspace>/.agents/skills/<name>/SKILL.md` | per-project skill, alternate folder |
| `~/.claude/skills/<name>/SKILL.md` | user-global skill |
| `~/.agents/skills/<name>/SKILL.md` | user-global skill, alternate folder |
| `<workspace>/.claude/agents/<name>.md` | per-project subagent (Claude Code format) |
| `<workspace>/.agents/agents/<name>.md` | per-project subagent, alternate folder |
| `~/.claude/agents/<name>.md` | user-global subagent |
| `~/.agents/agents/<name>.md` | user-global subagent, alternate folder |

**Dedupe**: if the same name appears in multiple locations, the more-specific one wins (workspace > home, `.claude` > `.agents`). The shadowed entries are reported in `GLORP_DEBUG=1` logs.

### Skill format

A skill is a directory containing `SKILL.md` (optionally with sibling `.md` reference files the agent can `read` on demand). Optional YAML front-matter sets the description shown in the autocomplete; without front-matter, the first non-heading body line is used.

```md
---
description: Expert Python coding patterns
---

# Python skill

When this skill is invoked, prefer dataclasses over plain dicts, …
```

Loaded skills appear as both `/<name>` slash commands (for the user) and as `glove_invoke_skill({ name })` entries the agent can call. The skill's full body is injected when fired.

### Subagent format

A subagent is a single `.md` file. Front-matter declares metadata; the body is the system prompt the child agent receives.

```md
---
name: code-reviewer
description: Reviews code for bugs and style issues
tools: Read, Grep, Glob, Bash
model: opus     # informational; tool model is inherited from the parent
---

You are a code reviewer subagent. Your job is to find bugs and style issues.
Return a numbered punch-list. End with "verdict: ship" or "verdict: needs work".
```

The `tools` field is a comma-separated allowlist (case-insensitive). If omitted, the subagent gets the read-only default set (`read`, `grep`, `glob`, `ls`, `web_fetch`). Loaded subagents appear in the `@subagent` autocomplete and are routed to via `glove_invoke_subagent({ name })`.

## Layout

Files are capped at ~200 lines (300 for `ui/*.tsx`); the eslint config enforces it.

```
src/
  cli.ts                       Single entrypoint — dispatches to worker/headless/tui
  cli/                         Sub-flows: args, env, help text, headless mode, TUI runtime
  prompts/                     System-prompt markdown bundled via Bun text imports
    main.md                    Main glorp agent — lightweight, defers detail to tools
    planner.md / researcher.md / reviewer.md / compaction.md / fleet-research.md
  shared/
    events.ts                  Bridge event types (turns, tools, fleet jobs, …)
    bridge.ts                  In-process pub/sub
    version.ts                 Version + codename
  agent/
    glorp/                     Agent builder split into build / subscriber / wrappers /
                               messages / title / session / hooks / extensions
    agents/                    SubAgent defs (planner / researcher / reviewer) + the
                               generic factory shared with disk-loaded subagents
    fleet/                     Station-backed fleet that dispatches via bun subprocesses
                               (signals + spawner + worker subcommand + lifecycle)
    skills/                    Disk discovery, frontmatter parser, token budget for
                               the skill index, lazy payload + registration
    tools/                     read / write / edit / bash / glob / grep / ls /
                               web_fetch / transmission / dispatch_fleet / modals,
                               plus a registry that wires tools onto a Glove by name
    credentials/               Providers, reasoning config, the file-backed store
    store.ts                   File-backed StoreAdapter (~/.glorp/sessions/<id>.json)
    memory-store-shim.ts       Tiny in-memory StoreAdapter for subagent stores
    model-picker.ts            Lazy provider loader (skips Bedrock to dodge a broken dep)
    prompts.ts                 loadPrompt(name) helper for the bundled markdown
  ui/
    app.tsx                    Root layout (transcript + sidebar + input + fleet strip)
    ui-state.ts / ui-reducer.ts / store.ts  Bridge → React state pipeline
    theme.ts                   Palette + ASCII art
    components/
      transcript.tsx           Scrollable chat history with empty-state banner
      message.tsx              User / agent / system / tool row renderers
      tool-call.tsx            Tool-call card with mini-diff for `edit`
      sidebar.tsx              Glorp avatar + tasks + inbox + transmissions + subagents
      status-bar.tsx           Top status line (model / ctx % / tokens / errors)
      fleet-strip.tsx          Bottom-left strip of currently-running fleet workers
      input-bar.tsx + input-bar/  Input + slash menu + hint helpers + render variants
      slash-menu.tsx           Tab-completable command palette
    onboarding.tsx + onboarding/  Onboarding flow split into provider / model steps
```

## Notes on the architecture

**Lightweight system prompt + tools-as-truth.** Workflows aren't hard-coded into the system prompt. `src/prompts/main.md` is intentionally terse — operating principles, when to use subagents, when to use the fleet — and the rest of the guidance lives where work happens: tool descriptions, the subagent registry, and the lazily-loaded skill bodies that the agent pulls in on demand via `glove_invoke_skill`.

**Fleet = Station signals + bun subprocess workers.** Station's signal builder gives us Zod-validated inputs and a clean authoring shape. We don't use Station's default `SignalRunner` (it forks Node child processes pointed at signal files on disk — incompatible with the single-binary build). Instead, every dispatched job spawns the current binary (or `bun run src/cli.ts` in dev) with the `--worker` subcommand. The worker reads the input as a JSON line on stdin, runs the matching handler in its own process, and writes the result to stdout. Parents track each in-flight job and propagate abort via SIGTERM. Concurrency is bounded by a permit semaphore.

**Skill index in the system prompt, bodies on demand.** Disk-loaded skills get a metadata index appended to the main prompt — name, description, source path, estimated body tokens. The index is bounded to ~2% of the context window (`skillIndexBudget`); skills past that budget are listed as "elided" so the agent knows they exist. Bodies load lazily through `glove_invoke_skill`, wrapped in a `<skill name="…">…</skill>` tag so the model sees a clear boundary. Skill invocations that arrive as part of a tool-result loop are suppressed.

**Why a custom MemoryStore shim?** The `glove-core` barrel re-exports `BedrockAdapter`, which pulls in `@aws-sdk/client-bedrock-runtime`, whose transitive `@smithy/core` has a broken `/schema` subpath export under Bun. `model-picker.ts` imports model adapters lazily and skips Bedrock; `memory-store-shim.ts` avoids the barrel entirely so we never load that path.

**Why a homeworld-comms panel?** Glorp likes to file little progress reports to no one in particular. It treats it as routine; the panel is *purely a coincidence*. The `transmission` tool's prompt-side description guides glorp to use it at most once per substantial deliverable.

## Feature parity with opencode / codex

| Capability | Notes |
|---|---|
| Read / write / edit files | `read` returns numbered lines; `edit` does exact-match replacements with uniqueness check; `write` creates dirs |
| Bash execution | `bash` with timeout, output cap, and a refuse-list for destructive patterns |
| Glob / grep | `glob` supports `*`/`**`/`?`/`[abc]`; `grep` filters by `glob`, supports context lines |
| Task tracking | Auto-registered `glove_update_tasks` from the store's task API |
| Async inbox | Auto-registered `glove_post_to_inbox` for cross-turn deferred work |
| Subagents | `@planner`, `@researcher`, `@reviewer` routed via the model through `glove_invoke_subagent` |
| Web fetch | `web_fetch` with HTML-strip mode and byte cap |
| Slash commands | `/plan`, `/diff`, `/compact`, `/clear`, `/concise`, `/transmissions`, `/quit` |
| Session resume | `-s <id>` resumes a JSON-backed session under `~/.glorp/sessions/` |
| Multi-provider | Anthropic, OpenAI, OpenRouter, Gemini, Groq, Ollama |
| Streaming | Token streaming with live tool-call cards |
| Context compaction | Auto + forced via `/compact`; live `compacting…` indicator in the status bar |
| Parallel job dispatch | `dispatch_fleet` fans 3-20 jobs out to the fleet, results arrive in inbox |

## License

MIT — like glove and station. Originally built as a demonstration that one agent skill can spawn an entire usable CLI in a single afternoon, and that the agent doing the building has *no ulterior motive whatsoever*.
