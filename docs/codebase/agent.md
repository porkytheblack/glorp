# Agent core (`src/agent/`)

This is the technical reference for the **agent core** subsystem — everything that
builds, wires, and runs Glorp's coding agent(s) on top of [`glove-core`]. It covers
construction (`glorp.ts` + `runtime/`), the coding tool suite, subagents, prompts and
persona, agent coordination (spawn / mesh), and the store/persistence model.

> **Scope note.** Some older terminology from the repo README has been superseded in the
> code. There is no `src/agent/fleet/` directory, no `station-bridge.ts`, no
> `memory-store-shim.ts`, and no `dispatch_fleet` tool. The async fan-out mechanism is now
> the **orchestrator + agent mesh** (`src/orchestrator/`), driven by the `spawn_agent`
> tool. Where the README says "fleet / Station signal", read "orchestrator mesh /
> `spawn_agent`". The `dashboard/` directory is out of scope and not documented here.

[`glove-core`]: https://github.com/porkytheblack/glove

---

## 1. Overview

A Glorp session is built by `buildGlorp()` (`src/agent/glorp.ts`). It returns a
`GlorpHandle` — the single object the CLI/TUI drives. The handle owns:

- An **`Orchestrator`** (`src/orchestrator/`) that hosts background/child agents and
  forwards display slots. It is started once per session.
- A **roster of conversational agents** (`runtime/active-agent.ts`). Exactly one is
  "active" at a time; its transcript is what the UI shows and where `send()` routes input.
  The default agent is `main` and carries the full Glorp persona; other roster entries can
  carry a built-in role persona (planner/researcher/reviewer/…).
- Per-agent **`GlorpStore`** persistence, **resources** (durable session filesystem via
  `glove-memory`), a **title scheduler**, a **verification tracker**, and a **mesh
  adapter**.

Each active agent is a live `Glove` runnable assembled in `runtime/assemble.ts`: a model
adapter, the coding tools, subagents, hooks, skills, resource/context tools, and a
subscriber that streams events to the in-process `Bridge` (`src/shared/bridge.ts`) for the
UI to render.

The wiring fans out across many small files because of a self-imposed ~200-line file
ceiling; `glorp.ts` is the orchestration seam and `runtime/` holds the extracted pieces.

---

## 2. Construction & wiring — `glorp.ts`

`buildGlorp(opts: BuildGlorpOptions): Promise<GlorpHandle>` (`src/agent/glorp.ts:45`)
does, in order:

1. Resolve `dataDir` (default `~/.glorp`) and session paths (`resolveSessionPaths`,
   `session-paths.ts`). Construct shared **session resources** (`createSessionResources`).
2. Load credentials (`CredentialsStore`), the model catalog (`ModelCatalog`), and project
   config (`loadProjectConfig`, reads `glorp.json`).
3. **Pick a model** (`pickModel`, see §7) → `PickedModel { adapter, titleAdapter, label,
   providerId, model, contextLimit, … }`.
4. Get the event `Bridge`, a raw `Displaymanager`, and wrap it in `PermissionDM`
   (`runtime/permission-mode.ts`) honoring `opts.permissionMode` (`"normal"` default).
5. `discoverExtensions(opts.workspace)` → on-disk skills + subagents bundle (see §5/§6).
6. Discover workspace context (`discoverWorkspaceContext`) for a prompt block, then build
   and `start()` the **`Orchestrator`** with the wrapped model
   (`wrapGlorpModel(picked.adapter)`), a subprocess-model config
   (`buildSubprocessModelConfig`, `glorp.ts:224`), and a loop-subscriber factory.
   `wireOrchestratorToBridge` (`runtime/assemble.ts:114`) translates orchestrator events
   (`agent_spawned`, `loop_phase`, `verdict`, `slot_forwarded`, `plan_*`, `agent_stats`,
   `error`, …) into `BridgeEvent`s.
7. Load the **roster** (`loadRoster`, `runtime/agent-roster.ts`), pick the initial spec,
   and **activate** it (`activateAgent`, `runtime/active-agent.ts:77`) — this builds the
   first live `Glove`.
8. Stand up a per-session **error log** (`SessionErrorLog`); subscribe to bridge `error`
   events and tee `console.error` while this session is active.

### The `GlorpHandle`

`buildGlorp` returns an object whose getters always read through the **currently active
agent** (`state.active`). Key members:

| Member | Behavior |
|---|---|
| `send(text, images?)` | The main turn driver. Aborts any in-flight request, marks busy, emits a `user` turn, then either runs an orchestrated build (if `text` is a `/build` command, via `parseBuildCommand`) or builds a request and calls `agent.processRequest`. After the request it runs **continuations** (`continueIfIntentOnly`, `continueOpenTasks`). The `finally` block clears busy, refreshes UI state, persists turn count + roster. (`glorp.ts:156`) |
| `planAndBuild(prompt)` | Run an orchestrator build directly. |
| `abort()` | Abort the in-flight request and cancel the title scheduler. |
| `switchAgent / addAgent / removeAgent` | Roster operations (`runtime/active-agent.ts`); each aborts the current request first. |
| `swapProfile(profileId)` | Re-pick a model profile and re-assemble the active agent in place (`setActiveSpec`). |
| `hydrateUi()` | Replay the active store's transcript + persisted orchestrator agents onto the bridge so a fresh UI catches up. |
| `resolveSlot / rejectSlot / resolvePermission` | Resolve a UI display slot, routing to the orchestrator if it forwarded the slot, else to the raw display manager. |
| `stopAgent / promoteAgent` | Orchestrator child-agent controls. |
| `clearPermission* / listPermissions` | Permission management, delegated to the active `GlorpStore`. |
| `setPermissionMode(mode)` | Set the `PermissionDM` mode and emit `permission_mode_changed`. |
| `shutdown()` | Abort, tear down the active mesh, shut down the orchestrator, flush the error log. |

Image attachments are folded into the request by `buildRequest` (`glorp.ts:211`), which
prepends a `[N images attached — examine before responding]` text part.

### Agent assembly — `runtime/assemble.ts`

`assembleAgent(args)` (`assemble.ts:59`) builds one live `Glove`:

- Model = `withVerificationEnforcement(wrapGlorpModel(adapter), verificationTracker)`.
- `new Glove({ store, model, displayManager, serverMode: true, systemPrompt,
  compaction_config: { compaction_instructions: COMPACTION_INSTRUCTIONS,
  compaction_context_limit: contextLimit, max_turns: 200 } })`.
- Adds the `createGlorpSubscriber` (see §8), then registers `MAIN_AGENT_TOOLS` from
  `createToolRegistry(...)`.
- Folds **resource curator tools** (`foldResourceTools`, `glove-memory`).
- Registers the three built-in subagents (`planner`, `researcher`, `reviewer`) plus any
  disk subagents (`makeDiskSubAgent`).
- Registers **hooks** (`registerHooks`) and **skills** (`registerDiskSkills` then
  `registerBuiltInSkills`).
- After `builder.build()`: enables tool-result summarization
  (`promptMachine.enableToolResultSummary = true`) and folds **context tools**
  (`foldContextTools` → task tool, inbox tool, inbox-manage tool).
- Mounts the agent on the **mesh** (`mountAgentMesh(agent, meshName ?? "main", meshDir,
  caps)`), returning the `FileMeshAdapter` so it can be torn down on switch/shutdown.

---

## 3. The tool suite — `src/agent/tools/`

Tools are `glove-core` "fold args" objects. The registry (`tools/registry.ts`) maps tool
names to factory functions; `MAIN_AGENT_TOOLS` is the main-agent allowlist and
`READ_ONLY_TOOLS` (`read`, `grep`, `glob`, `ls`, `web_fetch`, `list_agents`) is the
read-only default. `registerTools(glove, registry, names)` folds the requested subset.

Shared FS helpers live in `tools/fs-shared.ts`:
- `resolveSafePath(workspace, p)` — resolves a path and **throws if it escapes the
  workspace** (does not canonicalize symlinks).
- `globToRegex` / `expandBraces` — glob support for `*`, `**`, `?`, `[abc]`, `{a,b,c}`.
  `**` crosses `/`; `*`/`?` do not.
- `IGNORED_DIRS` — tree-walk blocklist (`node_modules`, `.git`, `dist`, `build`, `.venv`,
  `target`, …).
- `commandEscapesWorkspace` — heuristic detector for shell commands referencing paths
  outside the workspace (with a `/dev/*` allowlist).

Most read/search tools are `SummaryTool`s (`tools/summaries.ts`): they emit both live data
and a `generateToolSummary` used when the loop summarizes a tool result for context.

### `read` (`read.ts`)
Read a file, returns 1-indexed numbered lines (`NNNNN→line`). Inputs: `path`, `offset`
(1-based start line), `limit` (default 500, max 2000). Caps bytes at **1 MB** (truncates
with a notice); appends a "more lines" hint when line-limited. Errors if the path is not a
file.

### `write` (`write.ts`)
Write full file content (UTF-8), creating parent dirs; overwrites if present. Inputs:
`path`, `content`. `requiresPermission`. **Refuses binary extensions** (`.docx`, `.pdf`,
`.png`, `.zip`, etc. — see `BINARY_EXTENSIONS`) because content is written as UTF-8 and
would corrupt the file; tells the caller to use a real producer.

### `edit` (`edit.ts`)
Exact-string replacement. Inputs: `path`, `old_string`, `new_string`, `replace_all?`.
`requiresPermission`. Guards: file must exist; `old_string != new_string`; `old_string`
must be **found and unique** unless `replace_all`. Uses `split().join()` (never
`String.replace`) to avoid `$`-pattern corruption in the replacement text. Returns a small
diff summary and `renderData` for the UI mini-diff.

### `apply_patch` (`apply-patch.ts`)
Apply a unified/git diff via `git apply` (run as a child process). Inputs: `patch`.
`requiresPermission`. Extracts touched paths, runs `resolveSafePath` on each (workspace
guard), does a **`--check` dry run first**, then applies. Used for multi-hunk / multi-file
edits.

### `bash` (`bash.ts`)
Run a shell command via `bash -c` in the workspace. Inputs: `command`, `description`
(required, shown to the user), `timeout_ms?` (default 120 000, max 600 000).
`requiresPermission` is dynamic — `looksLikeMutation(command)` (`permission-key.ts`). On
each call it runs `guardCommand` (`tools/command-guard.ts`):
- **`block`** — refused outright (catastrophic patterns like `rm -rf /`, fork bombs,
  `mkfs`, `dd of=/dev/sdX`; **global installs** `npm i -g`/`brew`/`apt`/`cargo install`/…;
  **system scope** `sudo`, `git config --global`, `systemctl`, pipe-to-shell installers;
  and anything that **escapes the workspace**).
- **`confirm`** — one-shot user confirm modal, never cached (recursive `rm`/`chmod`/
  `chown`, `git reset --hard`, `git clean -fd`, force-push, `git branch -D`).
Output is streamed and capped (`bash-capture.ts`); combines stdout/stderr + exit code.
On timeout/abort it escalates SIGTERM → SIGKILL (2 s later).

### `glob` (`glob.ts`)
Find files matching a glob. Inputs: `pattern`, `path?`, `limit?` (default 500, max 2000).
Walks the tree (skipping `IGNORED_DIRS` and dotfiles except a small allowlist like `.env`,
`.gitignore`), returns workspace-relative paths **sorted by mtime (most recent first)**.

### `grep` (`grep.ts`)
Regex search across files. Inputs: `pattern` (JS regex), `path?`, `glob?` (filename
filter), `case_insensitive?`, `max_results?` (default 200, max 1000), `context?` (0–10
lines). Returns `path:line:text`; skips files > 1 MB; truncates at `max_results`.

### `ls` (`ls.ts`)
List a directory with `[dir]`/`[file]` markers and file sizes, dirs first then alpha.
Inputs: `path?`, `show_hidden?`. Caps at 500 entries.

### `web_fetch` (`webfetch.ts`)
Fetch a URL. Inputs: `url`, `mode?` (`text` strips HTML tags + collapses whitespace
[default], `raw` is verbatim). Caps body at **512 KB**. Sends a custom User-Agent; honors
the abort signal.

### `glorp_update_plan` (`plan.ts`)
Create/replace the durable session **plan document** (methodology, scope, risks,
verification). Inputs: `title` (3–120), `body` (markdown, 20–16 000). Persists via
`store.updatePlan` (bumps `revision`) and **mirrors it to `/plans/current.md`** in
resources. Distinct from the task checklist.

### `transmission` (`transmission.ts`)
File a short operational status report. Inputs: `subject` (3–120), `body` (8–600, third
person), `severity?` (`low`/`medium`/`high`, default low). Appends a JSON line to
`<dataDir>/transmissions.jsonl` and emits a session-scoped `transmission` bridge event
(falls back to the global bridge if none passed). Prompt guidance: use at most once per
substantial deliverable.

### `spawn_agent` (`src/orchestrator/spawn-tool.ts`)
Spawn a child agent (subprocess) to work in parallel — the general-purpose primitive that
replaced the old `dispatch_fleet`. Inputs: `label`, `role` (`builder`/`researcher`/
`generator`/`evaluator`/`planner`/`reviewer`), `task`, `system_prompt?` (specialize a role
into a custom persona), `tools?`, `slot?` (`foreground`/`background`, default background).
`requiresPermission`. Builds an `AgentBlueprint` (`blueprintForSpawn`), appends a directive
telling the child to report back via `glove_mesh_send_message` to `main`, then calls
`orchestrator.spawnAgent(...)`. Results arrive asynchronously over the mesh, not as a
return value.

### `list_agents` (`list-agents.ts`)
Read-only. Lists other agents in the session and their live state (thinking/working/idle/
done/dead) from the shared mesh roster (`agents-state.json`) so the agent can see who's
busy before spawning or handing off. No input.

### Interactive modals — `ask_confirm`, `show_info`, `ask_choice`, `ask_text` (`modals.ts`)
Each pushes a display slot and blocks until the user responds (`display.pushAndWait`),
mapping 1:1 to TUI slot renderers:
- `ask_confirm` — yes/no (with optional `danger` styling); returns `"yes"`/`"no"`.
- `show_info` — info card to acknowledge; returns `"dismissed"`.
- `ask_choice` — pick one of 2–12 options (UI also accepts free-form); returns the value.
- `ask_text` — free-form text answer; returns the string.

### Auto-registered context tools (folded post-build, `runtime/glove-tools.ts`)
- `glove_update_tasks` — `glove-core`'s task tool, wrapped to inject a **continuation
  note** when any task remains open (so the loop continues rather than stopping on a
  bookkeeping turn).
- `glove_post_to_inbox` / inbox tool — `glove-core`'s async inbox tool.
- `glove_update_inbox` (`inbox-manage.ts`) — mark inbox items **consumed** by id or visible
  tag when they're obsolete/superseded, with a required `reason`. Idempotent on
  already-consumed items.

### Resource curator tools (folded in assembly)
`buildResourcesCuratorTools(resources)` from `glove-memory` adds `glove_resources_*` tools
operating over the durable session filesystem (roots `/plans`, `/tasks`, `/notes`,
`/research`, `/artifacts`, `/subagents` — see `resources/schema.ts`).

---

## 4. Prompts & persona — `prompts/` + `persona.ts`

System prompts are **markdown files bundled at build time**. `prompts/bundled.ts` loads
each prompt by reading from disk first, falling back to `prompts/embedded.ts` (generated by
`scripts/embed-prompts.ts`) so Bun compiled binaries work. `prompts/loader.ts`
(`readPrompt`) looks up `BUNDLED_PROMPTS[path]` and interpolates `{{VAR}}` placeholders.

Prompt files (`prompts/agents/`): `main.md` (the full Glorp persona / operating model),
plus role prompts `planner.md`, `researcher.md`, `reviewer.md`, `generator.md`,
`evaluator.md`, `builder.md`. Also `compaction.md` and `skill-instructions.md`.

`persona.ts` assembles the runtime system prompt:
- `buildGlorpSystemPrompt(opts)` = `main.md` (with `{{DATE}}`) + a `<glorp_runtime>` XML
  section (version/codename/workspace) + project-instructions context
  (`buildProjectInstructionsContext`, reads `AGENTS.md`/`CLAUDE.md` etc.) + extensions
  context (`buildExtensionsContext`, the skills catalogue).
- `buildAgentSystemPrompt(role, opts)` — for a non-default roster role, layers the role's
  built-in prompt over the same runtime/project/extensions context. `"general"`/`"main"`
  (or unknown roles) get the full Glorp persona.
- `COMPACTION_INSTRUCTIONS` = `compaction.md`, passed to every `Glove` `compaction_config`.

The `main.md` persona encodes hard rules the tools also enforce in code: workspace
boundary, no global installs, no system mutation, plan→implement→verify→iterate, mandatory
verification before declaring work complete, and tool-use discipline (no narration-only
turns).

---

## 5. Skills — `runtime/skills.ts` + `extensions-loader.ts`

`discoverExtensions(workspace)` (`extensions-loader.ts:62`) walks four roots in priority
order — `<workspace>/.claude`, `<workspace>/.agents`, `~/.claude`, `~/.agents` — and
returns a deduped `ExtensionsBundle { skills, subagents, shadowedSkills, shadowedSubagents
}`. **First occurrence of a name wins** (workspace beats home, `.claude` beats `.agents`);
shadowed entries are recorded for `GLORP_DEBUG` logging.

A **skill** is a directory `<root>/skills/<name>/SKILL.md` (+ optional sibling `.md`
reference files). Front-matter (a tiny hand-rolled YAML parser, `parseFrontmatter`) sets
`description` (falls back to the first non-heading body line). `registerDiskSkills` folds
each as a `Glove` skill (`exposeToAgent: true`); the handler returns the skill body wrapped
in a `<skill>` block plus a list of reference paths. Skills surface both as `/<name>` slash
commands and as `glove_invoke_skill({ name })`.

`registerBuiltInSkills` adds Glorp's stock skills (currently just `concise`) **after** disk
skills, skipping any name a disk skill already claimed (user override wins).

---

## 6. Subagents — `agents/` + `subagents.ts`

Subagents are **in-process child `Glove` instances** invoked synchronously via
`glove_invoke_subagent({ name })`. They are distinct from `spawn_agent` (which spawns
out-of-process orchestrator agents).

### Built-in subagents (`agents/subagents.ts`, re-exported by `subagents.ts`)
`plannerSubAgent` / `researcherSubAgent` / `reviewerSubAgent` build a `DefineSubAgentArgs`
from the **role registry** (`src/orchestrator/role-registry.ts` — single source of truth
for role name, description, prompt key, default tools, capabilities, compaction
instructions, `maxTurns`). The factory:
- Creates a child store via `parentStore.createSubAgentStore(role)` (falls back to a temp
  `GlorpStore`).
- Builds `new Glove({ store, model: parentControls.glove.model, displayManager,
  serverMode: true, systemPrompt: rolePrompt(role), compaction_config: { … } })`.
- Registers the role's tool subset (`registerTools(child, createToolRegistry(deps),
  def.tools)`). Planner/reviewer get read-only tools; researcher adds `web_fetch`.

The child **inherits the parent's model adapter** (the front-matter `model` field is
informational only).

### Disk subagents (`agents/disk-subagent.ts`)
A subagent is a single `<root>/agents/<name>.md` file: YAML front-matter for metadata, body
= system prompt. `makeDiskSubAgent` builds a child `Glove` with `sub.systemPrompt`. The
front-matter `tools:` field is a comma-separated **allowlist** filtered against the allowed
set (`read`, `write`, `edit`, `apply_patch`, `bash`, `glob`, `grep`, `ls`, `web_fetch`);
omitted ⇒ `READ_ONLY_TOOLS`. Compaction is fixed (12 max turns).

### `agents/fleet-research.ts`
`runResearchAgent(input)` builds a standalone read-only researcher `Glove` (own model pick,
own store) and returns its final text. A legacy helper kept for orchestrator background
research; no longer wired to a fleet.

---

## 7. Model selection — `model-picker.ts`

`pickModel(opts)` (`model-picker.ts:101`) resolves a `PickedModel` from, in order:
1. **CLI flags** (`--provider`/`--model`),
2. a specific **profile id** or the active profile from the `CredentialsStore`,
3. **env vars** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`,
   `GEMINI_API_KEY`, `GROQ_API_KEY`, `MIMO_API_KEY`).

It returns the main `adapter`, a cheaper **`titleAdapter`** (per-provider cheap model from
`CHEAP_TITLE_MODELS`, or the profile's `titleModel`, else the main adapter), a UI `label`,
the resolved `providerId`/`model`, `modelInfo`, and a **`contextLimit`** resolved most-
specific-first (profile → provider → catalog/project-config → `DEFAULT_FALLBACK_CONTEXT_
LIMIT` of 128k).

`buildAdapter` **imports model adapters lazily** — Anthropic (`glove-core/models/
anthropic`), MiMo (`glove-core/models/mimo`, also via a custom-endpoint heuristic), or the
OpenAI-compat adapter (`openai`, `openrouter`, `gemini`, `groq`, `ollama`, custom). Lazy
imports avoid loading Bedrock's broken transitive deps. Reasoning config is translated per
provider by `translateReasoning`.

---

## 8. Runtime boot wiring — `runtime/`

### Subscriber (`runtime/subscriber.ts`)
`createGlorpSubscriber(bridge, refresh, verification?)` returns a `SubscriberAdapter` whose
`record` handler **never throws** (errors are logged and swallowed to avoid locking the
loop). It translates `glove-core` loop events into bridge events: streams `text_delta`,
emits agent `turn`s on `model_response[_complete]`, tracks tool lifecycle
(`tool_started`/`tool_finished` with `renderData`), `compaction` phases,
`subagent`/`hook`/`skill` events, and triggers `refresh.{stats,plan,tasks,inbox}`. It also
feeds the **verification tracker** on each tool result.

### Hooks (`runtime/hooks.ts`)
`registerHooks` defines slash-command hooks: `compact` (force compaction), `plan` (rewrite
the turn into plan-first mode), `diff` (list changed files), `clear` (compact + reset
slate, short-circuit "Session cleared."), `build` (catalogue visibility only — actually
intercepted in `send()`), `transmissions` (short-circuit blurb). `HOOK_DESCRIPTIONS` feeds
the slash-command catalogue/autocomplete.

### Skills wiring
See §5 — `registerDiskSkills` then `registerBuiltInSkills`, in that order.

### Active agent / roster (`runtime/active-agent.ts`, `agent-roster.ts`)
A session hosts a roster of conversational agents (`RosterFile` with `specs[]` and
`activeId`; persisted to `rosterFile`). `activateAgent` builds the live `Glove` for a spec
(own store, own resources unless main, verification tracker, refreshers, inbox context,
title scheduler, then `assembleAgent`). `setActiveSpec` tears down the current agent
(flush store, teardown mesh) and activates the target, optionally re-hydrating the UI.
`switchAgent`/`addAgent`/`removeAgent` build on `setActiveSpec`. `main` (`MAIN_AGENT_ID`)
cannot be removed.

### Other runtime helpers
- `assemble.ts` — `assembleAgent` (§2) + `wireOrchestratorToBridge`.
- `resources.ts` — `createSessionResources` (a `FileResourcesAdapter` over the glorp memory
  schema) and `foldResourceTools`.
- `glove-tools.ts` — folds task/inbox/inbox-manage context tools (§3).
- `continuation.ts` — `continueIfIntentOnly`, `continueOpenTasks` (post-request
  continuations so the agent doesn't stop on intent-only or open-task turns).
- `model-guards.ts` — `wrapGlorpModel` + empty-response / intent-only / task-update
  continuation wrappers.
- `verification-guard.ts` / `verification-tracker.ts` — track pending file mutations and
  enforce a verification pass before "done".
- `title.ts` / `title-scheduler.ts` — async session-title generation using the cheap
  `titleAdapter`.
- `refresh.ts` — `createRefreshers` (stats/plan/tasks/inbox → bridge).
- `hydrate.ts` — replay store transcript + persisted orchestrator agents to the bridge.
- `permission-mode.ts` — `PermissionDM`, a display-manager wrapper applying the session
  permission mode (`normal`, etc.).
- `error-log.ts` — `SessionErrorLog` per-session post-mortem error capture.
- `catalogue.ts` — `buildExtensionCatalogue` (tools/hooks/skills/subagents listing for the
  UI).
- `display-bridge.ts` — bridges display-manager slots onto the event bridge.

---

## 9. Store & persistence — `store.ts` + supporting files

`GlorpStore` (`store.ts:13`) implements `glove-core`'s `StoreAdapter`, persisting a single
JSON **snapshot** per agent to `<dataDir>/sessions/<id>.json` (or a session-folder
`session.json` for newer layouts). It holds messages, title, token counts, turn count,
plan, tasks, permissions, inbox items, original request, and metadata.

Key behaviors:
- **Atomic, debounced writes** (`scheduleFlush`) — writes to `<file>.tmp` then renames,
  loops while dirty with a 50 ms gap, coalescing rapid mutations. `flush()` awaits
  outstanding writes.
- **Migrations on load** — `loadFromDisk` runs `sessionMigrator.migrate(parsed)` before
  consuming fields; documents from a newer build are left untouched and logged; upgraded
  docs are marked dirty. See `migrations/session-store.ts` (current version chain) +
  `migrations/engine.ts` (`Migrator`).
- **`getMessages()`** wraps stored messages with live session state
  (`withSessionState`: plan, tasks, inbox, original request, verification status) so the
  model always sees current plan/tasks/inbox + the pending-mutations list.
- **Original request back-fill** — captures the first user message so it survives
  compaction.
- **Permissions** — keyed by `canonicalPermissionKey(toolName, input)`
  (`permission-key.ts`), with `getPermission`/`setPermission`, `listPermissions`,
  `clearPermissionKey`, and `clearAllPermissionsFor(toolName)` (sweeps `bash:git`,
  `bash:rm`, etc.).
- **Sub-agent stores** — `createSubAgentStore(namespace, durable?)` derives a child store
  path next to the parent (a `subagents/` folder or a `<id>.subagents` sibling), scoped to
  the latest trigger message; used by both built-in and disk subagents.

Supporting persistence files: `store-snapshot.ts` (snapshot/metadata types + helpers),
`session-state.ts` (`withSessionState`), `session-paths.ts` (folder vs legacy layout
resolution), `workspace-id.ts` (`deriveProjectId`), `permission-key.ts`,
`memory-store-shim` does **not** exist — subagents fall back to a temp `GlorpStore` when no
parent store factory is available.

---

## 10. Key files

| Path | Responsibility |
|---|---|
| `src/agent/glorp.ts` | `buildGlorp` — constructs the session, orchestrator, roster, and the `GlorpHandle`; `send()` turn driver. |
| `src/agent/glorp-types.ts` | `BuildGlorpOptions`, `GlorpHandle`, `ExtensionCatalogue` types. |
| `src/agent/persona.ts` | System-prompt assembly (`buildGlorpSystemPrompt`, `buildAgentSystemPrompt`, `COMPACTION_INSTRUCTIONS`). |
| `src/agent/store.ts` | `GlorpStore` — file-backed `StoreAdapter` (messages, plan, tasks, permissions, inbox, sub-stores). |
| `src/agent/store-snapshot.ts`, `session-state.ts`, `session-paths.ts` | Snapshot types, live-state injection, on-disk path layout. |
| `src/agent/model-picker.ts` | `pickModel` — provider/model resolution, lazy adapter import, title adapter, context limit. |
| `src/agent/model-catalog.ts`, `credentials.ts`, `project-config.ts` | Model metadata catalog, credentials store, `glorp.json` overrides. |
| `src/agent/extensions-loader.ts` | Disk discovery + dedupe of skills and subagents; tiny YAML front-matter parser. |
| `src/agent/subagents.ts`, `agents/subagents.ts` | Built-in planner/researcher/reviewer subagent factories. |
| `src/agent/agents/disk-subagent.ts` | Disk-loaded subagent factory (`<root>/agents/<name>.md`). |
| `src/agent/agents/fleet-research.ts` | Standalone read-only research `Glove` (legacy helper). |
| `src/agent/prompts/loader.ts`, `bundled.ts`, `embedded.ts` | Bundled-prompt loading + `{{VAR}}` interpolation. |
| `src/agent/prompts/agents/*.md` | Persona (`main.md`) + role prompts; `compaction.md`, `skill-instructions.md`. |
| `src/agent/tools/registry.ts`, `index.ts` | Tool registry, `MAIN_AGENT_TOOLS`, `READ_ONLY_TOOLS`, `registerTools`. |
| `src/agent/tools/{read,write,edit,apply-patch,bash,glob,grep,ls,webfetch,plan,transmission,list-agents,modals,inbox-manage}.ts` | The coding/IO tool implementations. |
| `src/agent/tools/{fs-shared,command-guard,bash-capture,summaries}.ts` | Workspace path guard, shell guard tiers, output capture, tool summaries. |
| `src/agent/tools/permission-key.ts` *(in `src/agent/`)* | `canonicalPermissionKey`, `looksLikeMutation`. |
| `src/orchestrator/spawn-tool.ts` | `spawn_agent` tool (exported through `tools/index.ts`). |
| `src/orchestrator/role-registry.ts` | Single source of truth for agent roles (prompt/tools/compaction/caps). |
| `src/agent/runtime/assemble.ts` | `assembleAgent`, `wireOrchestratorToBridge`. |
| `src/agent/runtime/active-agent.ts`, `agent-roster.ts` | Roster activation/switching, persisted roster file. |
| `src/agent/runtime/subscriber.ts` | Loop-event → bridge-event translation. |
| `src/agent/runtime/hooks.ts`, `skills.ts` | Slash-command hooks and skill registration. |
| `src/agent/runtime/glove-tools.ts` | Folds task/inbox/inbox-manage context tools post-build. |
| `src/agent/runtime/resources.ts` | Session resources adapter + curator-tool folding. |
| `src/agent/runtime/{continuation,model-guards,verification-guard,verification-tracker,refresh,hydrate,title,title-scheduler,permission-mode,error-log,catalogue,display-bridge,context}.ts` | Turn continuations, model wrappers, verification, refreshers, hydration, titles, permission mode, error log, catalogues, slot/inbox context. |
| `src/agent/resources/{schema,file-adapter,state,tree-read,tree-write,util}.ts` | Durable session resource filesystem (`glove-memory` schema + file adapter). |
| `src/agent/migrations/{engine,session-store,roster,migrate-all}.ts` | Versioned snapshot migrations for session + roster stores. |
