---
name: glorp
description: Guide for downstream coding agents driving Glorp — especially Glorp Garage (the remote multi-session control plane) and its sandboxes (Garage-provisioned workspaces). Use when programmatically creating sessions, running coding agents over the REST/WebSocket API, the @porkytheblack/glorp-client SDK, or the @porkytheblack/glorp-mcp MCP server, provisioning tenant namespaces, sandboxes from templates, exchanging files, or wiring Glorp into CI/orchestration. Also use for the higher-level Task API — the black-box surface where you submit a typed job (make a video, build a deck, review a PR, fix a bug) and poll one object for the result, without managing sessions, templates, or the event stream.
---

# Driving Glorp & Glorp Garage

You are an agent working *with* Glorp programmatically — not the Glorp TUI user. This
skill tells you how to start a Garage, create sessions, run coding agents inside
**sandboxes**, and collect their results, safely and without deadlocking.

**Glorp** is a coding agent (read/write/edit/bash/glob/grep/ls/web_fetch, subagents,
a mesh for fan-out). You can run it three ways:

| Mode | Command | Use when |
|---|---|---|
| **TUI** | `glorp` | A human is driving interactively. Not your path. |
| **Headless one-shot** | `glorp -p "…"` | One prompt, one workspace, exits when done. |
| **Garage** | `glorp garage` | You need *many* concurrent, long-lived, remotely-driven sessions. **This is your path for orchestration.** |

> **Don't conflate two subsystems.** "Glorp **Garage**" (this skill) is the multi-session
> HTTP/WS control plane. It is *not* the `station-signal` fleet runner (a separate async
> fan-out framework). Garage was formerly named "Station", so older notes may use that name.

### Two surfaces — pick the altitude you need

Garage exposes the same runtime at two levels. Choose deliberately:

| Surface | You manage | Reach for it when |
|---|---|---|
| **Sessions** (most of this skill) | sessions, workspaces, permission modes, the event stream | you want fine-grained control — multi-turn conversations, live streaming, custom orchestration |
| **Task API** ([jump](#task-api--typed-jobs-one-object-to-poll)) | *one object* — submit an `input`, poll a `result` | you just want a typed job done (a deck, a video, a PR fix) and a deliverable back, with no session/stream bookkeeping |

Tasks are built **on top of** sessions (a task *is* a worker session under the hood), so the two coexist — you can start with the Task API and drop to the session layer only if you outgrow it.

---

## Core model: sessions, workspaces, sandboxes

- A **session** is one running Glorp agent with its own conversation, plan, tasks, and
  permission state. State: `provisioning → idle ⇄ busy → (error) → destroyed`.
- A **workspace** is the directory the agent reads and edits. Two kinds:
  - **Caller-supplied workspace** — an existing host directory you point at
    (`"workspace": "/abs/path"`). Garage **never deletes** these.
  - **Sandbox** — a workspace Garage *provisions itself* under `workspaceRoot`
    (default `<data-dir>/workspaces`). Created when you omit `workspace`, or when you
    provision from a `template`. Garage may clean these up. **Sandboxes are the safe
    target for `bypass`/`auto` unattended runs and disposable work.**

The distinction matters for cleanup: `DELETE /sessions/:id?workspace=true` removes the
folder **only if it is a Garage-provisioned sandbox under `workspaceRoot` that no other
session references.** Caller-supplied and shared workspaces are always kept. So you can
safely cascade-delete a sandbox without risking a user's real repo.

---

## Set up glorp

Needs [Bun](https://bun.sh) ≥ 1.3. Build the binary (or run from source), then give it
a model provider key:

```bash
git clone https://github.com/porkytheblack/glorp && cd glorp
bun install
bun run build                          # → dist/glorp (single binary); or: bun run src/cli.ts
export ANTHROPIC_API_KEY=sk-ant-…      # or OPENAI_API_KEY / OPENROUTER_API_KEY / GEMINI_API_KEY / GROQ_API_KEY
```

The provider key is what the *agents* run on; the Garage API key (below) is separate and
gates *access to the control plane*. Persistent config lives in a `garage.json` under the
data dir (CLI flags override it). Full setup guide: [`docs/garage-usage.md`](./docs/garage-usage.md).

## Start a Garage

```bash
glorp garage                       # REST + WS on http://127.0.0.1:4271 (loopback, auth OFF)
glorp garage --host 0.0.0.0        # remote-reachable → auth REQUIRED automatically
glorp garage --workspace-root /srv/sandboxes   # where sandboxes get provisioned
```

- Loopback (`127.0.0.1`) binds are **open**; any non-loopback bind **requires an API key**.
  Force either way with `GLORP_GARAGE_AUTH=required|off`.
- Credentials for the agents themselves come from `~/.glorp` config or env vars
  (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …).
- Persistent config: a `garage.json` in the data dir (CLI flags override it).
- Every endpoint is served at both `/api/v1/…` (stable) and the bare root. Prefer
  `/api/v1` for anything durable.
- **Back-compat:** `glorp station` still works as a hidden alias for `glorp garage`, and
  the legacy `GLORP_STATION_*` env vars and a `station.json` config file are still honored.

### Auth (non-loopback)

```bash
glorp garage keys add ci-bot --scopes admin   # prints the raw glsk_… key ONCE — capture it
glorp garage keys list
glorp garage keys revoke <id>
```

Send it as `Authorization: Bearer glsk_…` on REST, or `?api_key=glsk_…` on the WebSocket
(browsers can't set WS headers). Scopes: `admin` > `run` > `read`. `/health` is always open.

---

## Recommended: the typed SDK

Prefer [`@porkytheblack/glorp-client`](./docs/glorp-client.md) over raw
curl when you're in a TS/JS context — it handles framing, reconnects, and errors.

```ts
import { configure, run } from "@porkytheblack/glorp-client";

configure({ endpoint: "http://127.0.0.1:4271", apiKey: "glsk_…" });  // or env GLORP_ENDPOINT/GLORP_API_KEY

const h = await run({
  workspace: "/srv/projects/acme",      // existing dir; OR omit for a fresh sandbox; OR { workspaceId }
  prompt: "Add a /health endpoint and a test for it.",
  // permissionMode defaults to "auto" so unattended runs don't deadlock on a prompt
});

const { text, status } = await h.result();   // blocks until the turn finishes
```

Run handle: `h.sessionId`, `await h.status()`, `for await (const ev of h.events())` (live
stream), `await h.result({ timeoutMs })`, `await h.abort()`.

Full client for multi-turn / admin work:

```ts
import { createClient } from "@porkytheblack/glorp-client";
const glorp = createClient({ endpoint, apiKey });

const ws = await glorp.workspaces.create("/srv/projects/acme");
const s  = await glorp.sessions.createInWorkspace(ws.id, { permissionMode: "auto" });
const { text } = await glorp.sessions.sendMessageAndWait(s.id, "Refactor the auth module.");
```

Non-2xx throws a typed `GlorpRemoteError` with `.status` / `.code` (e.g. `401` = bad key).

---

## Raw REST (when you can't use the SDK)

Session lifecycle, the loop you'll write most often:

```bash
BASE=http://127.0.0.1:4271/api/v1
H='content-type: application/json'
# (add  -H "authorization: Bearer glsk_…"  on any non-loopback Garage)

# 1. Create a session. Omit "workspace" to get a fresh SANDBOX under workspaceRoot.
ID=$(curl -s -X POST $BASE/sessions -H "$H" \
      -d '{"permissionMode":"auto"}' | jq -r .id)

# 2a. Fire-and-forget (202): run in background, then watch WS or poll.
curl -s -X POST $BASE/sessions/$ID/messages -H "$H" \
  -d '{"text":"Run the test suite and fix any failures"}'

# 2b. OR block until the turn finishes (best for CI / scripts):
curl -s -X POST $BASE/sessions/$ID/messages -H "$H" \
  -d '{"text":"Run the tests and fix failures","wait":true,"timeout_ms":600000}' | jq .

# 3. Poll status / collect the latest answer without re-sending:
curl -s $BASE/sessions/$ID            | jq '{state,busy,turn_count}'
curl -s $BASE/sessions/$ID/result     | jq '{status,busy,text,error}'

# 4. Abort a runaway turn:
curl -s -X POST $BASE/sessions/$ID/abort

# 5. Tear down. ?workspace=true also rm's the folder IFF it's a disposable sandbox.
curl -s -X DELETE "$BASE/sessions/$ID?workspace=true"
```

Key endpoints (full table in [`docs/garage-usage.md`](./docs/garage-usage.md),
contract in [`docs/openapi.yaml`](./docs/openapi.yaml)):

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/sessions` / `/workspaces/:id/sessions` | Create session (body below) |
| `GET` | `/sessions` · `/sessions/:id` | List · detail (poll `state`/`busy` here) |
| `POST` | `/sessions/:id/messages` | Send a prompt (`wait` for sync) |
| `GET` | `/sessions/:id/result` | Latest answer + run status, one call |
| `POST` | `/sessions/:id/abort` | Stop the current turn |
| `DELETE` | `/sessions/:id[?workspace=true]` | Destroy (optionally rm the sandbox) |
| `GET/POST/DELETE` | `/sessions/:id/files[/:path]` | The `uploads/` file exchange |
| `POST/DELETE` | `/sessions/:id/credentials` | Per-session key (in-memory only) |
| `GET/POST` | `/workspaces[…]` | Register / list / inspect workspaces |
| `GET` | `/templates` · `/health` | Setup templates · liveness (open) |

`POST /sessions` body (all optional):

```jsonc
{
  "workspace": "/home/dev/my-app",   // existing dir; OMIT → fresh sandbox under workspaceRoot
  "workspaceId": "ws_…",             // OR attach to a registered workspace
  "template": "next-app",            // OR provision a sandbox from a template
  "params": { "repo": "me/my-repo" },// template interpolation values
  "provider": "anthropic", "model": "claude-sonnet-4-20250514",
  "permissionMode": "normal",        // normal | auto | bypass  (see below)
  "credentials": { "provider":"anthropic", "apiKey":"sk-ant-…", "model":"…" } // never persisted
}
```

---

## Sandboxes from templates

Templates provision a sandbox **before** the agent starts — clone a repo, install deps,
drop in config. Put JSON files in `<data-dir>/templates/`; the filename is the template name.

```json
// ~/.glorp/templates/next-app.json
{
  "description": "Clone a repo and install deps",
  "steps": [
    { "type": "git-clone", "repo": "https://{env:GH_TOKEN}@github.com/{param:repo}.git", "ref": "main" },
    { "type": "shell", "command": "bun install" },
    { "type": "copy", "from": "/home/dev/templates/glorp.json", "to": "glorp.json" }
  ]
}
```

- Step types: `git-clone` (`repo`, optional `dest`/`ref`), `shell` (`command`), `copy` (`from`,`to`).
- Interpolation: `{param:NAME}` from the request `params`, `{env:VAR}` from Garage's env.
  Interpolated values are scrubbed from error messages (secret-safe).
- Steps run sequentially. **On any failure the sandbox is torn down and creation fails** —
  you never get a half-provisioned workspace. (Only a Garage-created dir is removed; a
  pre-existing caller dir is left intact.)

```bash
curl -s -X POST $BASE/sessions -H "$H" \
  -d '{"template":"next-app","params":{"repo":"me/my-repo"},"permissionMode":"bypass"}'
```

---

## Permission modes — pick deliberately

Unattended runs **deadlock** if a tool asks for permission and nobody answers.

| Mode | Behavior | Use for |
|---|---|---|
| `normal` | Prompts on risky ops; you must resolve each slot | A human/agent actively watching the stream |
| `auto` | Auto-approves *safe* ops, prompts on risky ones | **Default for unattended runs** (SDK `run()` uses this) |
| `bypass` | No prompts at all | **Disposable sandboxes only** — never a user's real repo |

If you stay in `normal`, you must answer permission slots as they arrive:
- REST: `POST /sessions/:id/slots/:slotId` → `{ "action": "approve" }` (or `deny`/`resolve`+`value`/`reject`+`reason`).
- WS command: `{ "type": "resolve_permission", "slot_id":"…", "allow": true }`.
- Or in `wait` mode pass `"auto_approve": true` to clear prompts for that one turn.

---

## File exchange (`uploads/`)

Each session has an `uploads/` folder inside its workspace — the hand-off point. Drop inputs
in for the agent; the agent writes deliverables (`.pptx`, `.zip`, exports) back for you.
Paths are confined to the folder (`..` traversal → `400`).

```bash
curl -s -F file=@./brief.pdf $BASE/sessions/$ID/files          # upload
curl -s $BASE/sessions/$ID/files | jq .                        # list
curl -s $BASE/sessions/$ID/files/deck.pptx -o deck.pptx        # download
```
SDK: `client.sessions.uploadFile/files/downloadFile/deleteFile`.

---

## Streaming over WebSocket

Connect `GET /sessions/:id/events` (auth via `?api_key=`). You get a `session_hydrate`
snapshot, then a live stream. Each frame: `{ "sessionId", "seq", "event": {…} }`. `seq` is
monotonic per client — **a gap means you missed events**; send `{ "type":"resync" }` or
reconnect to re-hydrate. Commands you can push back: `send_message`, `abort`,
`resolve_permission`, `set_permission_mode`, `resync`. SDK: `h.events()` / `streamSession()`.

---

## Per-session credentials

`POST /sessions/:id/credentials` swaps a session onto its own provider key; `DELETE` reverts.
The key is **in memory only** — never persisted, logged, or returned (responses show provider
+ last-4). Re-supply after a Garage restart.

---

## Multi-tenant namespaces

Provision an isolated **namespace** per user so their sessions/workspaces/sandboxes/
credentials can't see each other (data lives under `<dataDir>/namespaces/<id>/`,
sandboxes under `<workspaceRoot>/<id>/`). Requires auth on. Admin-only control plane:

```bash
# Provision + mint a tenant-bound key (raw key returned once)
curl -sX POST $EP/api/v1/namespaces -H "authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' -d '{"name":"acme"}'            # -> ns_acme
curl -sX POST $EP/api/v1/namespaces/ns_acme/keys -H "authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' -d '{"name":"acme-bot"}'        # -> glsk_… (run,read)

# Tenant uses ITS key — every call auto-scopes to ns_acme.
curl -sX POST $EP/api/v1/sessions -H "authorization: Bearer $TENANT" \
  -H 'content-type: application/json' -d '{"permissionMode":"auto"}'

# Admin proxies into any namespace via a header (?ns=<id> for WebSocket):
curl -s $EP/api/v1/sessions -H "authorization: Bearer $ADMIN" -H 'x-glorp-namespace: ns_acme'

# Deprovision (revokes keys, stops sessions; ?data=true wipes the subtree).
curl -sX DELETE "$EP/api/v1/namespaces/ns_acme?data=true" -H "authorization: Bearer $ADMIN"
```

Same flow with the SDK (needs an **admin** key):

```ts
const glorp = createClient({ endpoint, apiKey: ADMIN_KEY });
const ns = await glorp.namespaces.create("acme");                   // -> { id: "ns_acme", … }
await glorp.namespaces.createKey(ns.id, "acme-bot");                // raw glsk_… returned once
// The tenant then drives its OWN namespace with that key: createClient({ endpoint, apiKey: <it> }).
```

Requests with no namespace resolve to the built-in `default` namespace (the legacy
single-tenant layout) — existing setups keep working unchanged. Each namespace can
hold its own model credentials, falling back to the garage's defaults when unset — and
its own **template library** (see [Companions](#companions), below).

**Per-namespace template libraries.** Beyond the garage-global catalog in
`<dataDir>/templates/`, a namespace can have its own templates two ways: on-disk files
under its subtree (`<dataDir>/namespaces/<id>/templates/*.json`), and/or its own
**companion registry**. Resolution is **inherit-and-override**, newest-wins:
`tenant disk > tenant companion > garage disk > garage companion`. So a tenant's
`GET /templates`, `/templates/:name`, and `/tasks/types` all reflect *its* effective
catalog. A namespace with neither its own dir nor companion inherits the garage catalog
unchanged. The companion route is covered next.

---

## Companions

A **companion** is a small external service Garage talks to for two things it
deliberately doesn't own (full wire spec: [`docs/companion-service-spec.md`](./docs/companion-service-spec.md)):

1. **Git tokens** — it holds the GitHub App key and mints short-lived install tokens;
   Garage *pulls* one when a template clone needs auth (never stores it).
2. **A template registry** — it hosts Template v2 documents; Garage **only GETs** them
   and provisions workspaces from them. The service can generate/rotate templates however
   it likes.

Garage only ever issues `GET`s with static headers, and the companion is **optional at
runtime**: if it's down, Garage serves the last-known-good catalog and keeps working.

**Global companion** — one registry for the whole Garage. Set it via env (or `garage.json`):

```bash
export GLORP_GARAGE_TEMPLATE_REGISTRY_URL=https://companion.example/v1/templates
export GLORP_GARAGE_TEMPLATE_REGISTRY_HEADERS='{"authorization":"Bearer <garage-key>"}'
```

**Per-namespace companion** — give a tenant its **own** registry (its own key → its own
library) at provision time. This is how each client gets a different catalog:

```bash
curl -sX POST $EP/api/v1/namespaces -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -d '{
  "name": "acme",
  "template_registry": {
    "url": "https://companion.example/v1/templates",
    "headers": { "authorization": "Bearer <acme-tenant-key>" }
  }
}'
```

```ts
// SDK equivalent — third arg is the per-namespace registry.
await glorp.namespaces.create("acme", undefined, {
  url: "https://companion.example/v1/templates",
  headers: { authorization: "Bearer <acme-tenant-key>" },
});
```

- The `url` must be **http(s)**. The `headers` (the tenant's key) are stored server-side
  and **never returned** — `GET /namespaces/:id` exposes only `template_registry_url`.
- The tenant's companion templates layer in as `tenant disk > **tenant companion** > garage
  disk > garage companion`, so they beat the garage catalog but yield to the tenant's own
  on-disk overrides. Everything the tenant reads (`/templates`, `/tasks/types`) reflects this.
- Companion templates inline their skill files, so a tenant needs no on-disk assets — the
  whole catalog can live in the companion.

---

## MCP server (for MCP-capable agents)

If you're an MCP client (Claude Desktop/Code, Cursor, a custom orchestrator), you
can drive a Garage as **tools** instead of raw REST: run
[`@porkytheblack/glorp-mcp`](./docs/glorp-mcp.md), which wraps the kit and speaks
MCP over stdio (default) or streamable HTTP (`--http`, `POST /mcp`).

```bash
GLORP_ENDPOINT=$EP GLORP_API_KEY=$KEY npx @porkytheblack/glorp-mcp          # stdio
GLORP_ENDPOINT=$EP GLORP_API_KEY=$KEY npx @porkytheblack/glorp-mcp --http   # HTTP /mcp
```

Tools (`glorp_*`): namespaces (`list/get/create/delete`, `mint_namespace_key`,
`list_namespace_keys`), workspaces (`list/create/delete`), sessions (`run`, `list`,
`get`, `send_message`, `session_result`, `abort`, `destroy`), and the agent roster
(`list_agents`, `add_agent`, `switch_agent`, `remove_agent`). Each session/workspace/
agent tool takes an optional `namespace` for admin proxying. Admin tools `403`
cleanly if the configured key isn't admin. Full guide: [`docs/mcp.md`](./docs/mcp.md).

---

## Task API — typed jobs, one object to poll

The **black-box surface**: hand Garage a job and get a result, without touching
sessions, templates, or the event stream. **A task is one object** — an `input`
you submit and a `result` you poll (or receive via webhook) until it's
`completed`/`failed`. **A task type is a template name**, so the catalog is
self-extending: a new capability is a new template server-side, no app change.

```ts
import { createClient } from "@porkytheblack/glorp-client";
const glorp = createClient({ endpoint, apiKey });   // or GLORP_ENDPOINT / GLORP_API_KEY

// 1. Submit — returns immediately; the work runs in the background.
const { id } = await glorp.tasks.create({
  type: "slide-deck",
  input: { prompt: "A 5-slide deck on our Q3 results" },
  // permission_mode defaults to "bypass" (a task's worker runs in a fresh sandbox)
});

// 2. Wait — polls to completion, answering any questions the agent asks.
const task = await glorp.tasks.wait(id, {
  onQuestion: (q) => (q.kind === "confirm" ? true : q.options?.[0]?.value ?? ""),
  onProgress: (note) => console.log("…", note),
});

// 3. Use the result.
if (task.status === "completed") {
  console.log(task.result.summary);
  for (const f of task.result.files) {                 // deliverables
    await fs.writeFile(f.path, await glorp.tasks.downloadFile(id, f.path));
  }
} else console.error("task failed:", task.error);
```

**Lifecycle** (projected live on every read, never stored):
`queued → working ⇄ needs_input → completed | failed`, with `failed` reachable
from any state. A `defer_start` submit adds a `staged` step —
`queued → staged → (upload inputs, then start) → working` — so you can attach
input files before the first turn runs.

**What makes tasks different from a raw session:**

- **Deliverable contracts gate completion.** A task type whose template declares
  a `required` deliverable never reads `completed` on a text reply alone — it
  stays `working` until the agent produces an artifact that satisfies the
  contract (right file type, exists, passes a structural magic-byte check, passes
  any `verify` command). This is the model-independent lever that stops a
  "make a video" task from handing back a JSON storyboard or finishing with no
  file. Nudge a stuck task with `tasks.message(id, "…")`.
- **A cumulative usage meter** rides every read (`task.usage`: `tokens_in/out/total`,
  `cost_usd`, `cost_known`). It's monotonic and **survives context compaction**,
  so you can poll it, diff against your last reading, and bill the delta.
  `cost_known: false` means an unpriced model was used — treat `cost_usd` as a floor.

**The methods you'll actually call:**

| Call | Does |
|---|---|
| `tasks.types()` | list submittable types + their typed inputs (build a form / validate) |
| `tasks.create({ type, input:{ prompt, params? }, permission_mode?, callback_url?, defer_start? })` | submit; returns `{ id }` |
| `tasks.wait(id, { onQuestion, onProgress })` | poll to a terminal state, answering questions |
| `tasks.get(id)` / `tasks.list()` | read one / all task objects (own the loop yourself if you prefer) |
| `tasks.answer(id, questionId, value)` | answer a `needs_input` question (`choice`→value, `confirm`→bool, `text`→string, `info`→null) |
| `tasks.message(id, "now fix X")` | follow up; the task keeps its workspace + context and re-delivers |
| `tasks.files(id)` / `tasks.downloadFile(id, path)` | list / fetch deliverables (in `uploads/`) |
| `tasks.createWithInputs(input, files)` | the files-first path: create deferred, upload into `inputs/`, start — one call |
| `tasks.delete(id)` | cancel + remove the session and workspace |

**Webhooks (skip polling):** pass `callback_url` at submit time and Garage POSTs
the full task object on every transition into `needs_input`/`completed`/`failed`.
Delivery is fire-and-forget (5s timeout, **not retried**), so keep `tasks.get()`
as the source of truth and reconcile on a timer.

**Operator note:** infra secrets (a render key/URL) are **managed params** set
once on the host (`GLORP_GARAGE_TASK_PARAM_<NAME>=…` or `taskParams` in
`garage.json`). They're authoritative, applied to every task, and hidden from
`tasks.types()`, so a submitting app never sees or supplies them. To hand a task
runtime **env vars**, declare a template `env` map (`{env}`/`{param}`
interpolated, isolated per task).

Raw REST mirrors all of this under `/tasks…` (`Authorization: Bearer <key>`,
optional `X-Glorp-Namespace`). **Full walkthrough — happy path, the task object,
input files, answering questions, webhooks, and the REST table — is bundled at
[`docs/tasks.md`](./docs/tasks.md).**

---

## Gotchas & safety

- **Don't `bypass` against a real repo.** Reserve `bypass` for sandboxes you'll delete.
- **Default to `auto` for anything unattended** or your run hangs on the first prompt.
- **Poll `state`/`busy`** (`GET /sessions/:id`) or stream — don't assume a turn is done.
  Use `GET /sessions/:id/result` to fetch the latest answer without re-prompting.
- **`wait:true` needs a real `timeout_ms`** for long jobs (e.g. test suites: `600000`).
- **Cleanup is guarded:** `?workspace=true` only removes disposable sandboxes; it will not
  delete a caller-supplied or shared workspace. Safe to call on sandboxes; a no-op-on-folder
  for real repos.
- **Capture API keys at creation** — the raw `glsk_…` is shown exactly once.
- **`/health` is unauthenticated** — use it for liveness probes.

## Where to read more

Reference docs are bundled with this skill under [`./docs/`](./docs/):

- [`docs/tasks.md`](./docs/tasks.md) — the Task API integration guide (the black-box typed-job surface)
- [`docs/garage-usage.md`](./docs/garage-usage.md) — full usage guide (CLI, REST, WS, templates)
- [`docs/companion-service-spec.md`](./docs/companion-service-spec.md) — the companion wire spec (git tokens + template registry)
- [`docs/openapi.yaml`](./docs/openapi.yaml) — the machine-readable contract
- [`docs/remote-orchestration.md`](./docs/remote-orchestration.md) — driving Garage remotely
- [`docs/mcp.md`](./docs/mcp.md) — the MCP server (drive Glorp from any MCP agent)
- [`docs/glorp-client.md`](./docs/glorp-client.md) — the typed SDK (`@porkytheblack/glorp-client`)
- [`docs/glorp-mcp.md`](./docs/glorp-mcp.md) — the MCP server package (`@porkytheblack/glorp-mcp`)
- [`docs/codebase/garage-internals.md`](./docs/codebase/garage-internals.md) — how Garage works under the hood
- [`docs/codebase/networking.md`](./docs/codebase/networking.md) — server/client/protocol/SDK internals
