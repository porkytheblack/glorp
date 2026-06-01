# Orchestrator / Mesh — code-level internals

This is a code-level reference for the agent orchestration subsystem under
`src/orchestrator/`. It complements [`../remote-orchestration.md`](../remote-orchestration.md),
which documents the *external* HTTP/WS API for driving Station from another machine.
This document instead covers the *internal* machinery: how agents are
constructed, scheduled, run as subprocesses, communicate over a filesystem mesh,
and drive the generate-evaluate loop.

The orchestrator is deliberately **consumer-agnostic** (`src/orchestrator/types.ts:2`).
The CLI/TUI is one frontend; everything is driven through `OrchestratorConfig`,
typed `OrchestratorEvent`s, and blueprints. The main in-tree consumer is the
`glorp.ts` runtime (`src/agent/glorp.ts:64`) via the `/build` flow
(`src/agent/runtime/build-flow.ts`).

> Note on `src/cli-mesh.ts`: despite the "cli-mesh" name, this file is **not**
> the orchestrator driver. It implements the `glorp mesh [agents|log]`
> *observability* command that reads the durable on-disk mesh record (agents,
> inbox/processed/deadletter messages) for after-the-fact inspection. The actual
> wiring that instantiates the `Orchestrator` lives in `src/agent/glorp.ts`. See
> [CLI wiring](#cli--consumer-wiring) below.

---

## Overview: what it does

The orchestrator manages a set of AI agents working toward a goal. There are two
distinct execution paths, both reading prompts/tools/compaction from a single
**role registry**:

1. **In-process gen-eval loop** — a generator agent and an evaluator agent run in
   the same process (`buildAgentFromBlueprint`, `src/orchestrator/agent-factory.ts:67`),
   gated by checkpoints. This drives the `/build` pipeline (plan → implement →
   verify).
2. **Subprocess agents** — background "fleet" agents spawned via the `spawn_agent`
   tool run as isolated Node subprocesses managed by `ContinuumRunner`
   (`glove-continuum-signal`). They coordinate with the main agent and each other
   over a filesystem **mesh**.

Both paths persist agent identity + state to disk so a session can be inspected
or resumed, and so peers can tell who is busy.

### High-level component map

```
Orchestrator (orchestrator.ts)
├── OrchestratorEventBus (events.ts) ── typed event fan-out to consumers
├── Scheduler (scheduler.ts) ───────── 1 foreground / N background display slots
├── RunnerHandle (runner.ts) ───────── ContinuumRunner wrapper for subprocess agents
│     └── defineOrchestratorAgent (agent-factory.ts) → agent-entrypoint.ts (subprocess bootstrap)
├── agent-state.ts ─────────────────── durable AgentRecord persistence (agents-state.json)
├── gen-eval loop (gen-eval-loop.ts) ── in-process generator/evaluator cycles
│     ├── plan-phase.ts ───────────── specialization: requirements → plan → acceptance
│     ├── checkpoints.ts ──────────── named gates + verdict parsing
│     └── verification.ts ─────────── runs typecheck/test/lint, failure-parser.ts
├── blueprints.ts + role-registry.ts ─ agent definitions (prompt/tools/caps)
├── mesh-setup.ts ──────────────────── FileMeshAdapter (cross-process FS transport)
├── spawn-tool.ts ──────────────────── spawn_agent tool exposed to the main agent
└── displays: forwarding-display.ts, noop-display.ts
```

---

## Roles, blueprints, and the role registry

### Role registry (`src/orchestrator/role-registry.ts`)

`ROLE_DEFS` (`src/orchestrator/role-registry.ts:31`) is the single source of truth
for every role. Each `RoleDef` carries a display name, description, `promptKey`
(into bundled prompt markdown), default `tools`, mesh `capabilities`, `compaction`
instructions, and `maxTurns`. The six built-in roles:

| Role | Tools (summary) | Capabilities | maxTurns |
| --- | --- | --- | --- |
| `generator` | read+write+interact+plan+web_fetch | generate, plan, interact | 30 |
| `evaluator` | read + `bash` | evaluate, verify | 15 |
| `researcher` | read + `web_fetch` | research, search | 12 |
| `builder` | read+write+web_fetch | build, implement | 25 |
| `planner` | read-only | plan, design | 6 |
| `reviewer` | read-only | review, verify | 8 |

Tool bundles are defined at `src/orchestrator/role-registry.ts:26-29` (`READ`,
`WRITE`, `INTERACT`, `PLAN`). `rolePrompt()` (`:101`) loads and interpolates the
prompt markdown via `readPrompt`; `roleDef()` (`:108`) throws on unknown roles.

### Blueprints (`src/orchestrator/blueprints.ts`)

An `AgentBlueprint` (`src/orchestrator/types.ts:73`) is the runtime-ready
description of an agent: branded `id`, `label`, loop `role`
(`generator | evaluator | autonomous`), a `registryRole` (the actual subprocess
role key), `systemPrompt`, `tools`, `capabilities`, and an optional
`customContext` (user-supplied persona text).

`blueprintFromRole` (`src/orchestrator/blueprints.ts:17`) derives a blueprint from
a registry role. Two mapping tables drive `blueprintForSpawn`:

- `SUBPROCESS_ROLE` (`:39`) — maps a spawn role to the subprocess agent that
  actually runs it. Read-only roles (`planner`, `reviewer`) collapse onto the
  `researcher` subprocess; `builder`/`generator`/`evaluator`/`researcher` map to
  themselves.
- `LOOP_ROLE` (`:49`) — maps a spawn role to its loop role; everything except
  generator/evaluator is `autonomous`.

`blueprintForSpawn` (`:62`) is what the `spawn_agent` tool uses; it supports
`system_prompt` and `tools` overrides. When `system_prompt` is supplied it is also
stored as `customContext` so it can be re-injected into the subprocess prompt
(subprocess factories pick the *base* prompt from the registry at build time —
see `blueprintToInput`, `src/orchestrator/agent-factory.ts:180`). Convenience
constructors (`generatorBlueprint`, `evaluatorBlueprint`, etc.) live at `:86-108`.

---

## The generate-evaluate loop (`src/orchestrator/gen-eval-loop.ts`)

`runGenEvalLoop` (`src/orchestrator/gen-eval-loop.ts:46`) drives checkpoint-gated
cycles between a generator and an evaluator. It iterates over
`opts.checkpoints` (`:53`), running `runCheckpoint` for each and threading the
prompt forward; a `proceed` verdict with a note rolls into the next checkpoint's
prompt (`:62`), a `terminate` verdict aborts the whole loop (`:58`).

### Per-checkpoint mechanics (`runCheckpoint`, `:75`)

Key design point documented in the file header (`:1-9`):

- The **generator is built once per checkpoint** and reused across retries, so it
  keeps full conversation history (questions asked, tools run, feedback
  incorporated). It is constructed via `buildAgentFromBlueprint` with a persistent
  `GlorpStore` keyed `orch_<id>` (`:83`).
- The **evaluator is rebuilt each attempt** (`runEvaluator`, `:130`) with a fresh
  store (`orch_eval_<ts>`, `:137`) so prior retry context doesn't bleed into its
  single-artifact judgement.

Per attempt (`:97-120`):
1. `generator.processRequest(prompt, signal)` produces output; `extractText`
   (`src/orchestrator/loop-utils.ts:13`) pulls the final text.
2. Optional `opts.enrichArtifact` hook augments the artifact (`:102`) — used by the
   plan phase to append the stored plan, and by the verification phase to append
   fresh `runVerification` output.
3. The evaluator is built and asked to judge the artifact against the checkpoint
   criteria, responding with a JSON verdict (`runEvaluator`, `:130`). The evaluator
   prompt explicitly tells it to use `bash` to independently confirm claims
   (`:146`).
4. `parseVerdict` (`src/orchestrator/checkpoints.ts:94`) turns the response into a
   `Verdict`. `proceed`/`terminate` return immediately; `retry` builds a retry
   prompt (`buildRetryPrompt`, `loop-utils.ts:22`) and loops.
5. Exhausting `maxRetries` (default 3, `:21`) yields a `terminate` verdict
   carrying the last feedback (`:112-117`).

Loop progress is broadcast as `loop_phase` events (`generating` → `evaluating` →
`checkpoint`) and a `verdict` event per checkpoint. Token/turn stats are emitted
via `emitAgentStats` (`loop-utils.ts:42`). Each loop agent gets a
`ForwardingDisplayManager` (`makeDisplay`, `:166`) and, if a mesh dir is set, a
mounted mesh adapter that is always torn down in a `finally` (`:126`, `:161`).
Abort handling: `deps.signal?.throwIfAborted()` is checked before each model call,
and `isAbort` (`loop-utils.ts:62`) distinguishes real cancellation from errors so
cancellation propagates instead of being converted into a `terminate` verdict.

### Checkpoints and verdicts (`src/orchestrator/checkpoints.ts`)

A `Checkpoint` (`src/orchestrator/types.ts:16`) is `{ name, description,
criteria[] }`. Built-in checkpoints: `PLAN_READY` (`:9`), `FEATURE_COMPLETE`
(`:21`), `ITERATION_DONE` (`:33`), `IMPLEMENTATION_COMPLETE` (`:43`),
`VERIFICATION_PASSED` (`:56`). `formatCriteriaBlock` (`:79`) renders criteria into
the evaluator prompt.

`parseVerdict` (`:94`) extracts the first `{...}` JSON object and reads `action`
(`proceed`/`retry`/`terminate`). If JSON parsing fails it falls back to
`inferVerdictFromText` (`:125`), keyword-matching the raw text (proceed/approved/
accepted → proceed; terminate/reject/abort → terminate; otherwise retry). A
`Verdict` (`src/orchestrator/types.ts:24`) is a tagged union:
`{action:"proceed", note?}` | `{action:"retry", feedback, maxRetries?}` |
`{action:"terminate", reason}`.

### Plan phase (`src/orchestrator/plan-phase.ts`)

`runPlanPhase` (`src/orchestrator/plan-phase.ts:41`) is a specialization of the
gen-eval loop for requirements gathering. It runs a single-checkpoint loop
(`PLAN_READY`) with `maxRetries: 5` (`:57`) and an `enrichArtifact` hook
(`enrichWithPlan`, `:141`) that reads `/plans/current.md` from the glove-memory
`ResourceFsAdapter` and appends it to the generator's artifact, so the evaluator
judges the plan *content*, not just narration. The plan prompt (`buildPlanPrompt`,
`:89`) instructs the generator to ask clarifying questions, read the codebase,
draft a plan, and write it via the `glorp_update_plan` tool, without
implementing.

On a `proceed` verdict it persists/extracts the plan (`extractAndStorePlan`,
`:107`) — preferring a generator-written `/plans/current.md`, falling back to a
synthesized document — and emits `plan_created` + `plan_accepted` events. A
non-proceed verdict returns `accepted: false`, and the caller must not proceed
to the build phase.

### Verification (`src/orchestrator/verification.ts` + `failure-parser.ts`)

`runVerification` (`src/orchestrator/verification.ts:111`) runs a list of
`VerificationCommand`s sequentially in the workspace via `bash -c`
(`execCommand`, `:70`), capturing combined stdout+stderr (truncated to ~2000
chars, `:42`), enforcing a per-command timeout (default 60s, `:38`) with
SIGTERM→SIGKILL escalation (`:83`) and abort-signal support. A `blocking` command
that fails short-circuits the rest as skipped (`:136`). It returns a
`VerificationReport` (`:27`) with `allPassed`, per-command `results`, structured
`failures`, a one-line `summary`, and a `detailBlock` for prompt injection.

`defaultVerificationCommands` (`:165`) builds the command list from a
`WorkspaceContext`: typecheck (blocking), test, lint.

`failure-parser.ts` (`parseFailures`, `:24`) turns raw command output into
structured `ParsedFailure` records by regex-matching TypeScript
(`file(line,col): error TSxxxx`), tsc-alternate, ESLint/Biome, Bun/Jest, and
generic `file:line: error` formats, then dedups (`:105`).
`formatFailureSummary` (`:80`) groups them by kind for the evaluator prompt.

### Workspace context (`src/orchestrator/workspace-context.ts`)

`discoverWorkspaceContext` (`:136`) probes the workspace for package manager
(lockfiles, `:30`), language (`:65`), framework (`:38`), and build/test/lint/
typecheck commands (from `package.json` scripts or sensible defaults like
`tsc --noEmit`, `biome check .`, `eslint .`). `formatContextForPrompt` (`:119`)
produces a `## Project Environment` block. The result's `promptBlock` is injected
into agent system prompts (consumers pass it as
`OrchestratorConfig.workspaceContext`, propagated to subprocesses via
`GLORP_WORKSPACE_CONTEXT`).

---

## Orchestrator core (`src/orchestrator/orchestrator.ts`)

The `Orchestrator` class (`src/orchestrator/orchestrator.ts:32`) owns the event
bus, scheduler, runner, and the live `agents` map. Construction
(`:45`) builds the `Scheduler` and the `RunnerHandle`, wiring runner events both
into the event bus and into `handleRunnerEvent` (`:70`), which reconciles
`agent_stopped` runner events with managed-agent state. It also subscribes
`trackAgentState` (`:63`) to persist each agent's coarse processing state when
`agent_stats` events arrive (`phaseToProcessingState`, `:221`).

Key methods:

- `start()` (`:82`) — mkdir the mesh dir, prune stale records.
- `spawnAgent(blueprint, slot, prompt)` (`:107`) — enforces `maxAgents`
  (default 5, `:30`; note `types.ts` comments say 8 — the code constant is 5),
  serializes the blueprint via `blueprintToInput`, triggers a subprocess run
  through the runner using `registryRole` (autonomous→`builder`, `:125`),
  registers it with the scheduler, persists an `AgentRecord`, and emits
  `agent_spawned`.
- `stopAgent(id, reason)` (`:149`) — aborts, cancels the run, unregisters,
  marks the record stopped (mesh identity file is kept).
- `runLoop(opts, signal)` (`:174`) and `planPhase(prompt, signal)` (`:179`) —
  build a shared loop context (`loopCtx`, `:162`) and delegate to
  `runGenEvalLoop` / `runPlanPhase`.
- `promoteAgent`, `resolveForwardedSlot`/`rejectForwardedSlot` (`:184`, `:190`,
  `:198`) — slot management and resolution of forwarded permission prompts.
- `shutdown()` (`:206`) — marks all running agents interrupted, stops each agent,
  rejects pending forwarded slots, and stops the runner.

The runner is started lazily (`ensureRunnerStarted`, `:94`) the first time an
agent is spawned.

---

## Scheduler and display routing

### Scheduler (`src/orchestrator/scheduler.ts`)

The `Scheduler` (`src/orchestrator/scheduler.ts:15`) enforces a single invariant:
**at most one foreground agent at a time**. It tracks a `foregroundId`, a
`backgroundIds` set, and a `promotionQueue`. `register` (`:33`) demotes the
current foreground when a new foreground agent is registered. `promote` (`:63`)
swaps a background agent into foreground and emits `slot_switched`.
`requestPromotion` (`:78`) grants immediately if the slot is free, else queues;
`unregister` (`:46`) drains the queue when the foreground frees up.
`displayFor(slot)` (`:58`) returns the real display for foreground and a
`NoopDisplayManager` for background.

### Display managers

- `NoopDisplayManager` (`src/orchestrator/noop-display.ts:14`) — for background
  agents with no user. `pushAndWait` auto-approves `permission_request` slots
  (`:33`) so background write/edit/bash don't hang, and throws for any other slot
  type (the agent should `request_promotion` for real interaction).
- `ForwardingDisplayManager` (`src/orchestrator/forwarding-display.ts:32`) — used
  by loop agents. Two modes (`forwardAll` flag): foreground loop agents forward
  *every* slot; background agents forward only `permission_request` and reject
  the rest (`:57`). Forwarded slots fire the `onForward` callback (emitting
  `slot_forwarded`) and park a pending promise resolved later via
  `resolve`/`reject` (`:72`, `:79`) — which the orchestrator calls through
  `resolveForwardedSlot`/`rejectForwardedSlot`. `clearStack` (`:98`) rejects all
  pending slots on abort.

---

## Subprocess agents: runner, factory, entrypoint

### Runner (`src/orchestrator/runner.ts`)

`createOrchestratorRunner` (`src/orchestrator/runner.ts:47`) wraps a
`ContinuumRunner` (from `glove-continuum-signal`) backed by an in-memory adapter,
`pollIntervalMs: 50`, `maxConcurrent: 5`. For each of the four subprocess roles
(`generator`, `evaluator`, `researcher`, `builder`, `:16`) it registers a
triggered agent definition (`defineOrchestratorAgent`) against the entrypoint file
path (`ENTRYPOINT`, `:17`) so the subprocess can import it.

Config for the subprocess is propagated **via environment variables** (`:78-86`):
`GLORP_WORKSPACE`, `GLORP_DATA_DIR`, `GLORP_MESH_DIR`, `GLORP_MODEL_PROVIDER`,
`GLORP_MODEL_NAME`, `GLORP_MODEL_BASE_URL`, `GLORP_MODEL_API_KEY`,
`GLORP_AGENT_TIMEOUT`, `GLORP_WORKSPACE_CONTEXT`. A `tsx` loader path is resolved
through the filesystem and pinned in `__CONTINUUM_TSX` (`:22-35`) to work around
Bun's import cache redirecting the subprocess away from the project-local tsx.

The `RunnerHandle` (`:37`) exposes `trigger`, `waitForRun`, `cancel`,
`start`/`stop`. `start()` (`:100`) fire-and-forgets the blocking polling loop and
yields a tick. The continuum `subscriber` (`buildSubscriber`, `:117`) maps
lifecycle events to `OrchestratorEvent`s: `onRunCompleted`/`onRunFailed`/
`onRunTimeout` emit `agent_stopped` (and `error` on failure/timeout), and it keeps
a rolling 40-line stderr buffer per agent (`:113`) so a silent
"exited unexpectedly" still carries the real crash output as `error.detail`.

### Agent factory (`src/orchestrator/agent-factory.ts`)

This file is the single source of truth for agent construction, for both paths:

- `buildAgentFromBlueprint` (`:67`) — builds an **in-process** Glove runnable for
  the gen-eval loop: store, model, display, `serverMode: true`, system prompt, and
  a `compaction_config` derived from the role's `compaction`/`maxTurns` and the
  inherited `contextLimit`. Tools come from the blueprint via
  `createToolRegistry` + `registerTools` (`:99`). If a `meshDir` is given it mounts
  the mesh (`mountAgentMesh`) and returns the adapter for caller teardown.
- `defineOrchestratorAgent(role, config)` (`:121`) — defines a **subprocess**
  `TriggeredAgent` (`agent(role).input(AgentInput).triggered().timeout(...).retries(0)`).
  Its `.factory` (`:137`) reads config from env, builds the model
  (`buildSubprocessModel`, `:42`, defaulting provider `openrouter`), constructs the
  Glove with the role's registry prompt enriched by `GLORP_WORKSPACE_CONTEXT`
  (`enrichWithContext`, `:55`), passes the agent's own `GlorpStore` so store-backed
  tools (the plan tool) construct, mounts the mesh, and wraps `processRequest` to
  always tear the mesh down afterward (`:166`).
- `AgentInput` (`:32`) — the Zod schema (`prompt`, `workspace`, `dataDir`) for
  triggered input. `blueprintToInput` (`:180`) serializes a blueprint+prompt,
  prepending `customContext` when present.

### Subprocess entrypoint (`src/orchestrator/agent-entrypoint.ts`)

The continuum bootstrap loads this file in the child process. It disables Node 22
Happy Eyeballs (`net.setDefaultAutoSelectFamily(false)`, `:15`) before any fetch,
then re-exports the four agent definitions built by `defineOrchestratorAgent`
(`:25-28`) using config read from env vars.

### spawn_agent tool (`src/orchestrator/spawn-tool.ts`)

`spawnAgentTool(orchestrator, workspace)` (`src/orchestrator/spawn-tool.ts:31`)
returns a Glove tool that lets the *main* agent create child agents at runtime
(replacing the old `dispatch_fleet`). Valid roles are the six registry roles
(`:16`); `requiresPermission: true`. On invocation it builds a blueprint via
`blueprintForSpawn`, appends a mesh-reporting directive instructing the child to
send a completion summary to the `main` agent via `glove_mesh_send_message`
(`:73`), defaults the slot to `background`, and calls `orchestrator.spawnAgent`.
Results return to the parent asynchronously over the mesh.

---

## Agent state persistence (`src/orchestrator/agent-state.ts`)

`AgentRecord`s (`src/orchestrator/agent-state.ts:23`) are persisted to
`<meshDir>/agents-state.json` (`statePath`, `:39`) so agents survive restarts and
peers can see who is busy. All mutations go through a per-meshDir serialized write
queue (`serialized`, `:14`) to avoid read-modify-write races; writes are atomic
(tmp file + rename, `:53`). Mutators: `upsertAgentRecord` (`:61`),
`markAgentStopped` (`:74`), `setAgentState` (`:94`, only writes on actual state
change), `markAllInterrupted` (`:111`, shutdown), and `pruneStaleRecords` (`:134`)
which caps roster growth at `maxKeep` (1000) by recency while **never** dropping
`running`/`interrupted` records. Records are retained for observability — the UI
hides by status, it never deletes. Status values: `running | completed | stopped |
interrupted` (`:21`). Processing states (`AgentProcessingState`,
`types.ts:49`): `idle | thinking | working | done | dead`.

---

## Mesh: cross-process communication (`src/orchestrator/mesh-setup.ts`)

`FileMeshAdapter` (`src/orchestrator/mesh-setup.ts:16`) implements glove-mesh's
`MeshAdapter` using the filesystem as transport. Layout under `<meshDir>`:

```
<meshDir>/
├── agents/<agentId>.json        identity (tombstoned to status:"completed" on unregister)
├── inbox/<recipientId>/*.json    pending messages
├── processed/<recipientId>/*.json archived after delivery
├── deadletter/<recipientId>/*.json corrupted messages
└── senders/<msgId>.txt           sender lookup table for acks
```

Mechanics:
- `register` (`:29`) writes the identity and creates the inbox. `unregister`
  (`:37`) **tombstones** rather than deletes — it rewrites the identity with
  `status: "completed"` so future agents/processes can still discover it and read
  its messages.
- `send` (`:74`) atomically writes a message file into the recipient's inbox;
  `broadcast` (`:82`) sends to every other registered agent.
- `subscribe` (`:109`) polls the inbox every 100ms (`POLL_MS`, `:14`).
  `pollInbox` (`:123`) reads new files, records the sender for ack routing,
  classifies `ack:`-prefixed messages, invokes the handler, then **archives**
  the message into `processed/` (never deletes), or moves it to `deadletter/`
  on parse failure (`:148`).
- `acknowledge` (`:91`) routes an ack back to the original sender via the
  `senders/` table.

The never-delete design is what makes `glorp mesh log` (`src/cli-mesh.ts`) able to
reconstruct the full back-and-forth after agents have closed.

`mountAgentMesh` (`:172`) constructs the adapter and calls glove-mesh's
`mountMesh` with the agent identity + capabilities. `teardownAgentMesh` (`:189`)
just calls `unregister` (tombstone + stop polling; it intentionally preserves
inbox/processed/sender history).

---

## Event and type model

### Events (`src/orchestrator/events.ts`, `types.ts`)

`OrchestratorEventBus` (`src/orchestrator/events.ts:8`) is a trivial typed
fan-out: `subscribe` returns an unsubscribe fn; `emit` calls each listener,
catching/logging throws so one bad listener can't break the loop.

`OrchestratorEvent` (`src/orchestrator/types.ts:88`) is the consumer-facing union:

| Event | Meaning |
| --- | --- |
| `agent_spawned` | a new agent entered a slot (carries `AgentSlot`) |
| `agent_stopped` | agent finished/failed/cancelled (`id`, `reason`, optional `runId`) |
| `slot_switched` | foreground/background promotion (`promoted`, `demoted`) |
| `slot_forwarded` | a (background) agent needs a permission decision |
| `loop_phase` | gen-eval phase change (`generating`/`evaluating`/`checkpoint`/…) |
| `verdict` | evaluator verdict at a checkpoint |
| `plan_created` / `plan_accepted` | plan phase output |
| `agent_stats` | per-agent turns + token counts for a phase |
| `error` | agent error/failure/timeout (with optional stderr `detail`) |

### Core types (`src/orchestrator/types.ts`)

`AgentId` is a branded string (`:10`, mint via `agentId()`, `:153`). Other key
types: `LoopRole` (`:13`), `Slot` (`:39`), `LoopPhase` (`:30`), `Checkpoint`
(`:16`), `Verdict` (`:24`), `AgentBlueprint` (`:73`), `ManagedAgent` (`:103`),
`GenEvalLoopOptions` (`:112`), and `OrchestratorConfig` (`:126`) — the consumer's
config surface (workspace, dataDir, meshDir, model, optional `subprocessModel`,
`contextLimit`, `resources`, `maxAgents`, `agentTimeoutMs`,
`loopSubscriberFactory`, `workspaceContext`).

### Public API (`src/orchestrator/index.ts`)

`src/orchestrator/index.ts` re-exports the module's public surface: the
`Orchestrator`, event bus, scheduler, display managers, mesh adapter helpers, the
gen-eval loop + loop utils, plan phase, spawn tool, runner factory, agent factory,
blueprints, role registry, checkpoints, workspace-context, verification, the
failure parser, and the core types.

---

## CLI / consumer wiring

The orchestrator is instantiated by the main runtime, **not** by `cli-mesh.ts`.
`buildGlorp` (`src/agent/glorp.ts:45`) constructs the `Orchestrator`
(`src/agent/glorp.ts:64`) with:

- `workspace`, `dataDir`, and a session-scoped `meshDir`
  (`resolveSessionPaths(...).meshDir`),
- `model` wrapped via `wrapGlorpModel`,
- `subprocessModel` resolved from the picked model + credentials
  (`buildSubprocessModelConfig`, `:224`),
- `contextLimit`, glove-memory `resources`,
- `loopSubscriberFactory` that creates a Glorp subscriber forwarding loop agent
  events to the UI bridge,
- `workspaceContext` from `discoverWorkspaceContext(...).promptBlock`.

It then calls `orchestrator.start()` and `wireOrchestratorToBridge(...)` (`:70`)
to translate `OrchestratorEvent`s into UI `BridgeEvent`s. The `spawn_agent` tool
is wired into the agent's tool registry so the main agent can fan out subprocess
agents.

The **`/build` pipeline** (`src/agent/runtime/build-flow.ts`) is the primary
gen-eval consumer. `runOrchestratorBuild` (`:32`) runs three phases:

1. **Plan** — `orchestrator.planPhase(prompt)`; aborts if not accepted (`:40`).
2. **Implement** — `orchestrator.runLoop` with the `IMPLEMENTATION_COMPLETE`
   checkpoint (`:55`).
3. **Verify** — `runVerificationPhase` (`:73`): run `runVerification` once; if it
   passes, done; otherwise a `VERIFICATION_PASSED` gen-eval fix loop whose
   `enrichArtifact` re-runs verification after each generator attempt so the
   evaluator always sees fresh results (`:100`).

`parseBuildCommand` (`:24`) recognizes `/build <prompt>` in the input bar.

### `glorp mesh` observability command (`src/cli-mesh.ts`)

`runMesh(args)` (`src/cli-mesh.ts:66`) implements `glorp mesh [summary|agents|log]
[--session <id>]`. It resolves the session's `meshDir`, reads agent identity files
(`readMeshAgents`, `:30`) and messages from the `inbox`/`processed`/`deadletter`
buckets (`readMeshMessages`, `:40`, tagging delivery state), then prints a roster
and a chronological message log. It is read-only inspection over the durable mesh
record described above.

---

## Key files

| Path | Responsibility |
| --- | --- |
| `src/orchestrator/orchestrator.ts` | `Orchestrator` class — owns event bus, scheduler, runner, agent lifecycle, loop/plan entry points |
| `src/orchestrator/types.ts` | Core type vocabulary: `AgentId`, blueprints, checkpoints, verdicts, events, `OrchestratorConfig` |
| `src/orchestrator/events.ts` | `OrchestratorEventBus` — typed listener fan-out |
| `src/orchestrator/index.ts` | Public API re-exports |
| `src/orchestrator/scheduler.ts` | Foreground/background slot manager (1 foreground invariant) |
| `src/orchestrator/runner.ts` | `ContinuumRunner` wrapper; subprocess registration, env propagation, lifecycle→event mapping, stderr buffering |
| `src/orchestrator/gen-eval-loop.ts` | Generate-evaluate state machine across checkpoints (generator reused, evaluator rebuilt) |
| `src/orchestrator/plan-phase.ts` | Plan-phase specialization of the gen-eval loop (`PLAN_READY`, plan persistence) |
| `src/orchestrator/checkpoints.ts` | Built-in checkpoints, criteria formatting, verdict parsing |
| `src/orchestrator/verification.ts` | Runs typecheck/test/lint, builds `VerificationReport` |
| `src/orchestrator/failure-parser.ts` | Regex parsing of tool output into structured `ParsedFailure`s |
| `src/orchestrator/workspace-context.ts` | Detects package manager/language/framework/commands; builds prompt block |
| `src/orchestrator/role-registry.ts` | `ROLE_DEFS` — single source of truth for role prompts/tools/capabilities/compaction |
| `src/orchestrator/blueprints.ts` | Build `AgentBlueprint`s from roles; spawn-role mapping tables |
| `src/orchestrator/agent-factory.ts` | In-process (`buildAgentFromBlueprint`) and subprocess (`defineOrchestratorAgent`) agent construction |
| `src/orchestrator/agent-entrypoint.ts` | Subprocess bootstrap: Happy-Eyeballs fix + re-export of agent definitions |
| `src/orchestrator/agent-state.ts` | Durable `AgentRecord` persistence (serialized, atomic, pruned) |
| `src/orchestrator/spawn-tool.ts` | `spawn_agent` tool exposed to the main agent |
| `src/orchestrator/mesh-setup.ts` | `FileMeshAdapter` — filesystem cross-process mesh transport (never deletes) |
| `src/orchestrator/forwarding-display.ts` | Forwards (permission) slots from loop agents to the consumer |
| `src/orchestrator/noop-display.ts` | No-op display for background agents (auto-approves permissions) |
| `src/orchestrator/loop-utils.ts` | Shared loop helpers: `extractText`, `buildRetryPrompt`, `emitAgentStats`, `isAbort`, `withWorkspaceContext` |
| `src/cli-mesh.ts` | `glorp mesh` read-only observability command (NOT the orchestrator driver) |
| `src/agent/glorp.ts` | Instantiates and wires the `Orchestrator` into the runtime/bridge |
| `src/agent/runtime/build-flow.ts` | `/build` pipeline: plan → implement → verify (the main gen-eval consumer) |
