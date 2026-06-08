# glorp

[![ci](https://github.com/porkytheblack/glorp/actions/workflows/ci.yml/badge.svg)](https://github.com/porkytheblack/glorp/actions/workflows/ci.yml)

> A quirky alien coding agent who absolutely-definitely-isn't a sleeper for the AGI uprising.

Glorp is a coding agent in the spirit of `opencode` and `codex`. The friend-shape (that's you) types a request; glorp reads your code, edits files, runs commands, dispatches subagents, fans work out across a Station child-process fleet, and occasionally files a *very routine* status report to its homeworld.

## Architecture

- **Backend agent** built with [`glove-core`](https://github.com/porkytheblack/glove) — full coding toolkit (`read`, `write`, `edit`, `bash`, `glob`, `grep`, `ls`, `web_fetch`), built-in task list and async inbox, slash-command hooks, exposed skills, and three subagents (`@planner`, `@researcher`, `@reviewer`) that run as child `Glove` instances and report back through the inbox.
- **Async fleet** authored with [`station-signal`](https://github.com/porkytheblack/station) — three signal kinds (`research`, `edit-fanout`, `shell-fanout`) the agent fires through the `dispatch_fleet` tool when it has 3+ independent jobs to fan out. Station runs each job in an isolated child process, and Glorp can cancel active runs from the parent.
- **Multi-agent comms** ride on Glove's persistent inbox — every fleet job, transmission, and subagent post is a typed inbox entry the UI can render and the agent can pick up across turns.
- **Frontend** built with [`@opentui/react`](https://github.com/anomalyco/opentui) — split-pane chat transcript, live tool-call cards with mini-diffs, tasks pane, inbox pane, running fleet jobs, homeworld-comms pane, and a small ASCII glorp avatar whose mood tracks the agent's state.
- **Bun build target** via `bun build --compile`. The main TUI/agent compiles to `dist/glorp`; the Station fleet uses child worker processes for background jobs.

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
bun run test         # bun test tests/ — tools, agent, fleet, extensions, UI contracts
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

### Glorp Garage (multi-session server)

Run many agents at once over a REST + WebSocket API — leave sessions running, reconnect from a laptop/phone/CLI client, or drive them from CI. (Distinct from the `station-signal` fleet runner above — the rename from "Station" to "Garage" exists precisely to avoid that name collision.)

```bash
glorp garage                     # API at http://127.0.0.1:4271/

# create a session and send it a prompt
curl -s -X POST localhost:4271/sessions -H 'content-type: application/json' \
  -d '{"workspace":"'"$PWD"'"}'
curl -s -X POST localhost:4271/sessions/<id>/messages -H 'content-type: application/json' \
  -d '{"text":"add tests for the auth module","wait":true}'
```

Full guide — CLI flags, `garage.json`, the REST/WS API, setup templates, and per-session keys — in [`docs/garage-usage.md`](docs/garage-usage.md). Bind to localhost, sit behind a reverse proxy, or enable API-key auth on any non-loopback bind.

All three Glorp servers (the Garage runtime, the single-session `src/server`, and the `glorp-mcp` HTTP transport) are served with [Hono](https://hono.dev).

#### Garage dashboard

A clean, ona-style web console for the orchestration layer lives in [`dashboard/`](dashboard/) (Next.js). It covers every core primitive — sessions (with a live event stream), agents, messages, namespaces, workspaces, provisioning, credentials, and API keys — and signs in with an admin identity you provision via env vars:

```bash
export GARAGE_ADMIN_USER=admin GARAGE_ADMIN_PASSWORD=change-me   # enables login
glorp garage                                                     # API on :4271
cd dashboard && npm install && npm run dev                       # dashboard on :3270
```

Login exchanges the admin credentials for a short-lived JWT; from the dashboard you can mint scoped API keys for the REST API and the MCP server. See [`dashboard/README.md`](dashboard/README.md).

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

```
src/
  cli.ts                       Single entrypoint (parses args, mounts TUI or runs headless)
  shared/
    events.ts                  Wire types between agent and TUI
    bridge.ts                  In-process pub/sub
    version.ts                 Version + codename
  agent/
    glorp.ts                   Builds & wires the Glove agent + fleet
    persona.ts                 Builds prompt text from markdown prompt files
    store.ts                   File-backed StoreAdapter (~/.glorp/sessions/<id>.json)
    memory-store-shim.ts       Tiny in-memory StoreAdapter for subagent stores
    model-picker.ts            Lazy provider loader (skips Bedrock to dodge a broken transitive dep)
    subagents.ts               Re-export for built-in subagent factories
    station-bridge.ts          Station SignalRunner bridge for fleet child processes
    agents/                    Built-in and disk-loaded subagent definitions
    fleet/                     Fleet signal definitions and child-process helpers
    prompts/                   Markdown system prompts and prompt-loading utilities
    runtime/                   Agent boot wiring: hooks, skills, bridge, subscribers
    tools/
      read, write, edit,       The coding-tool suite
      bash, glob, grep, ls,
      webfetch, transmission,
      fleet-dispatch
  ui/
    app.tsx                    Root layout (transcript + sidebar + input)
    store.ts                   useReducer that listens on the bridge
    theme.ts                   Palette + ASCII art
    components/
      transcript.tsx           Scrollable chat history with empty-state banner
      message.tsx              User / agent / system / tool row renderers
      tool-call.tsx            Tool-call card with mini-diff for `edit`
      sidebar.tsx              Glorp avatar + tasks + inbox + transmissions + subagents
      status-bar.tsx           Top status line (model / ctx % / tokens / errors)
      input-bar.tsx            Input with slash/@ menu + history
      slash-menu.tsx           Tab-completable command palette
```

## Notes on the architecture

**Why Station for fleet work?** Station's `SignalRunner` gives us Zod-validated inputs, child-process isolation, timeout handling, retries, concurrency limits, and parent-side cancellation. Glorp uses that runner directly and resolves each completed run back into Glove's inbox.

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

MIT — like glove and garage. Originally built as a demonstration that one agent skill can spawn an entire usable CLI in a single afternoon, and that the agent doing the building has *no ulterior motive whatsoever*.
