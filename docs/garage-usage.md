# Glorp Garage — Usage Guide

> **Naming note.** "Glorp Garage" here is the **multi-session runtime** (`glorp garage`) — a long-running server that hosts many agent sessions over a REST + WebSocket API. It is *not* the same as the `station-signal` async **fleet** runner mentioned elsewhere in the README (which runs background fan-out jobs in child processes). The runtime was renamed from "Station" to "Garage" precisely to stop colliding with that fleet framework's name.

Garage lets you run multiple Glorp agents at once, leave them running, and connect from any client — an IDE extension, a CLI, or a CI pipeline. See [`garage-spec.md`](./garage-spec.md) for the product spec and rationale.

---

## Quick start

```bash
# Credentials: Garage inherits your global ~/.glorp config (run `glorp` once to onboard),
# or set an env var: export ANTHROPIC_API_KEY=... (or OPENAI_API_KEY, OPENROUTER_API_KEY,
#   GEMINI_API_KEY, GROQ_API_KEY, MIMO_API_KEY, GLM_API_KEY, KIMI_API_KEY)

glorp garage                 # REST + WS API on http://127.0.0.1:4271
```

### Custom / regional / coding-plan endpoints (env-only, no credentials.json)

Every provider honors a `<PROVIDER>_BASE_URL` override, so you can point it at a
custom or coding-plan endpoint with env vars alone (resolution: stored
credentials > `<PROVIDER>_BASE_URL` > built-in default). Xiaomi MiMo, Zhipu GLM,
and Moonshot Kimi are first-class providers (OpenAI-compatible, `Bearer` auth):

```bash
# Zhipu GLM coding plan (default base = z.ai coding endpoint)
GLM_API_KEY=…  glorp garage --provider glm --model glm-5.2

# Moonshot Kimi
KIMI_API_KEY=…  glorp garage --provider kimi --model kimi-k2.7-code

# Xiaomi MiMo Token Plan — set MIMO_BASE_URL to your regional plan endpoint
MIMO_API_KEY=tp-…  MIMO_BASE_URL=https://token-plan-sgp.xiaomimimo.com/v1 \
  glorp garage --provider mimo --model mimo-v2.5-pro
```

> Note: these subscription coding plans are meant for interactive coding; MiMo's
> Token Plan forbids automated backends, and GLM/Kimi carry similar intent —
> using them under autonomous Garage tasks may breach the provider's terms.

Then create a session and send it a prompt:

```bash
# Create a session for an existing directory
curl -s -X POST localhost:4271/sessions \
  -H 'content-type: application/json' \
  -d '{"workspace":"/home/dev/my-app"}'
# → { "id": "...", "state": "provisioning", "ws_url": "ws://127.0.0.1:4271/sessions/<id>/events", ... }

# Send a message and wait for the full turn (good for scripts/CI)
curl -s -X POST localhost:4271/sessions/<id>/messages \
  -H 'content-type: application/json' \
  -d '{"text":"Add rate limiting to the API routes","wait":true}'
```

For streaming (the normal interactive flow), open the WebSocket at `ws_url` and POST messages without `wait` — events arrive over the socket.

---

## CLI

```
glorp garage [options]

  --host <addr>           Bind address (default: 127.0.0.1)
  --port <port>           Port (default: 4271)
  --data-dir <dir>        State directory (default: ~/.glorp, or $GLORP_DATA_DIR)
  --workspace-root <dir>  Base dir for auto-provisioned workspaces
                          (default: <data-dir>/workspaces)
  --provider <name>       Default provider for new sessions
  -m, --model <name>      Default model for new sessions
  --auto-mode             Default permission mode: auto (approve safe ops)
  --bypass                Default permission mode: bypass (no prompts)
```

> Garage binds to `127.0.0.1` by default. A **non-loopback bind requires an API key automatically** (see [Authentication & remote access](#authentication--remote-access) below) — never expose Garage on a public interface without it. On loopback, same-origin/loopback browser requests are allowed and non-browser clients on the host can still reach the API, so only run it on a trusted machine or behind a reverse proxy / SSH tunnel.

### `garage.json`

Drop a `garage.json` in the data dir for persistent config (CLI flags win over it):

```json
{
  "hostname": "127.0.0.1",
  "port": 4271,
  "workspaceRoot": "/home/dev/glorp-workspaces",
  "templatesDir": "/home/dev/.glorp/templates",
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "permissionMode": "normal",
  "idleSessionTtlMs": 1800000,
  "gcIntervalMs": 60000
}
```

---

## Session lifecycle, idle GC & teardown

A session's `GlorpHandle` (its model adapter + any sandbox child processes) is
the real resource — call it the session's **agent host**. It is built lazily on
the first message and torn down on `destroy()`.

**Idle-session GC.** A long-running Garage otherwise accumulates *loaded* but
idle sessions, each pinning an agent host. The GC sweeps every namespace on an
interval and **unloads** any session that has been idle past a TTL — it isn't
busy and has no connected WebSocket client. Unloading frees the agent host but
**keeps the on-disk snapshot**, so the session goes dormant and rehydrates
transparently on the next request (no data loss, no manual cleanup). Tune it:

| Setting | `garage.json` | Env | Default |
|---|---|---|---|
| Idle TTL before unload (ms; `0` disables) | `idleSessionTtlMs` | `GLORP_GARAGE_IDLE_TTL_MS` | `1800000` (30 min) |
| GC sweep interval (ms) | `gcIntervalMs` | `GLORP_GARAGE_GC_INTERVAL_MS` | `60000` (60 s) |

**`destroy()` aborts a busy turn.** Destroying a session that is mid-turn first
**aborts** the running agent, then shuts the handle down — a busy session is
never silently left running and holding its slot. The session leaves
`GET /sessions` immediately; reclamation of any heavier sandbox the host sits in
(container/volume) is downstream of Garage and not synchronous.

**`GET /sessions/:id/result` reports a `reason`.** Alongside `status`/`busy`/
`text`/`error`, the result carries a machine-readable `reason` so a caller can
tell a genuine empty turn from "no worker engaged yet" or a failure — all of
which otherwise look like `{ busy:false, text:null, error:null }`:

| `reason` | Meaning |
|---|---|
| `running` | a turn is in flight |
| `ok` | a completed turn produced text |
| `empty` | a turn completed but produced **no** text (real empty answer) |
| `idle` | no turn has run yet (created/rehydrated, never engaged) |
| `provisioning` | still setting up (template / handle not built) |
| `error` | the session is in the unrecoverable error state |

See [`garage-namespace-ops.md`](./garage-namespace-ops.md) for the concurrency
model and operational guidance under churn.

---

## Authentication & remote access

Garage is **open on loopback** (localhost dev) and **requires an API key on any
non-loopback bind** — so `glorp garage --host 0.0.0.0` is auth-protected by
default. Force it either way with `GLORP_GARAGE_AUTH=required|off`.

```bash
glorp garage keys add ci-bot --scopes admin   # prints the key once (glsk_…)
glorp garage keys list
glorp garage keys revoke <id>
```

Send the key as `Authorization: Bearer glsk_…` (REST) or `?api_key=glsk_…` (the
WebSocket, which can't set headers from a browser). `/health` stays open.

### Multi-tenant namespaces

Run one Garage for many users by giving each an isolated **namespace** (its own
sessions, workspaces, sandboxes, and model credentials). An admin key provisions
namespaces and mints namespace-bound keys; a tenant key transparently scopes every
call to its own namespace. Requests with no namespace use the built-in `default`
namespace, so single-tenant setups are unchanged. Namespaces require auth on.

```bash
# Admin: provision a namespace and mint a tenant key (raw key shown once)
curl -sX POST $EP/api/v1/namespaces -H "authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' -d '{"name":"acme"}'                  # -> ns_acme
curl -sX POST $EP/api/v1/namespaces/ns_acme/keys -H "authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' -d '{"name":"acme-bot"}'             # -> glsk_…

glorp garage keys add acme-bot --namespace ns_acme   # ...or mint one offline via CLI
```

Admin keys can act inside any namespace with the `X-Glorp-Namespace: <id>` header
(`?ns=<id>` on the WebSocket). Deprovision with `DELETE /namespaces/:id?data=true`.
Full walkthrough in [`remote-orchestration.md`](./remote-orchestration.md).

For driving Garage from another machine or your own orchestration, see
[`remote-orchestration.md`](./remote-orchestration.md), the OpenAPI contract in
[`openapi.yaml`](./openapi.yaml), and the typed client
[`@porkytheblack/glorp-client`](../packages/glorp-client/README.md).

## Tasks — the simple black-box API

If you just want to hand Garage a job and get a result — "make this video",
"review this PR", "build this deck", "fix this bug" — use **tasks** instead of
wiring sessions, templates, slots, and the event stream yourself. A task is one
object with an `input` and a `result`; Garage provisions the right workspace,
runs a task-aware agent, surfaces any questions it asks, and exposes the
deliverable. (The lower-level session API below stays for advanced needs.)

A **task type is a template name** — the catalog is self-extending, so adding a
capability is adding a template, no server change.

```bash
# 1. Discover the task types and their inputs
curl -s $BASE/tasks/types
# → { "types": [ { "name":"slide-deck", "description":"…",
#                  "inputs":[ { "name":"AUDIENCE", "required":false, … } ] }, … ] }

# 2. Submit a task (returns immediately; the work runs in the background)
curl -s -X POST $BASE/tasks -H 'content-type: application/json' \
  -d '{ "type":"slide-deck",
        "input":{ "prompt":"A 5-slide deck on our Q3 results" },
        "callback_url":"https://you.example/hook" }'   # callback optional
# → 202 { "id":"task_…", "type":"slide-deck", "status":"queued" }

# 3. Poll one object until it settles (or receive the callback)
curl -s $BASE/tasks/task_…
# → { "id":"…", "status":"completed",
#     "result":{ "summary":"5-slide deck on Q3", "files":[ { "path":"deck.pptx", … } ] },
#     "questions":[], "progress":null, … }

# If status is "needs_input", answer the pending question and it resumes:
curl -s -X POST $BASE/tasks/task_…/answers -H 'content-type: application/json' \
  -d '{ "question_id":"<questions[0].id>", "answer":"formal" }'

# Follow up with a change — the same task keeps its context:
curl -s -X POST $BASE/tasks/task_…/messages -H 'content-type: application/json' \
  -d '{ "text":"make the title slide darker" }'

# Download a deliverable, then clean up:
curl -s $BASE/tasks/task_…/files/deck.pptx -o deck.pptx
curl -s -X DELETE $BASE/tasks/task_…
```

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/tasks/types` | Available task types + their inputs (from the template catalog) |
| `POST` | `/tasks` | Submit a task — `{ type, input:{ prompt, params? }, permission_mode?, callback_url? }` |
| `GET` | `/tasks` | List tasks |
| `GET` | `/tasks/:id` | The task object (status, result, questions, progress, files) |
| `POST` | `/tasks/:id/messages` | Follow-up instruction (continues the same task) |
| `POST` | `/tasks/:id/answers` | Answer a pending question — `{ question_id, answer }` |
| `POST`/`GET`/`DELETE` | `/tasks/:id/files[/:path]` | Upload inputs / download deliverables |
| `DELETE` | `/tasks/:id` | Cancel + delete the task, its session, and its workspace |

**Status** is `queued → working → needs_input → completed → failed`. With an
optional `callback_url`, Garage POSTs the task object on every transition into
`needs_input`, `completed`, or `failed` — so you can avoid polling. Tasks run in
`bypass` permission mode by default, so they pause only for deliberate questions.

The kit wraps all of this: `client.tasks.create({ type, input })` then
`client.tasks.wait(id, { onQuestion })` (polls to completion, answering
questions), plus `.get`, `.message`, `.answer`, `.files`, `.uploadFile`,
`.downloadFile`, `.delete`.

**→ Full integration guide for app developers: [docs/tasks.md](./tasks.md)** —
the task object shape, status lifecycle, answering questions, follow-ups,
webhooks, and copy-paste recipes for video / deck / PR-review / bug-fix.

## REST API

Every path is served at the stable `/api/v1` prefix **and** at the bare root
(e.g. `GET /api/v1/sessions` ≡ `GET /sessions`). JSON in, JSON out.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/sessions` | Create a session (body below) |
| `GET` | `/sessions` | List sessions (live + dormant on-disk) |
| `GET` | `/sessions/:id` | Session detail |
| `DELETE` | `/sessions/:id[?workspace=true]` | Destroy session (optionally rm its workspace) |
| `POST` | `/sessions/:id/messages` | Send a message (see body below) |
| `POST` | `/sessions/:id/abort` | Abort the current request |
| `POST` | `/sessions/:id/slots/:slotId` | Resolve a permission/input slot |
| `GET` | `/sessions/:id/history` | Conversation turns |
| `GET` | `/sessions/:id/plan` | Current plan |
| `GET` | `/sessions/:id/tasks` | Task list |
| `GET` | `/sessions/:id/permissions` | Granted permissions |
| `DELETE` | `/sessions/:id/permissions/:key` | Revoke a permission |
| `POST` | `/sessions/:id/permission-mode` | `{ "mode": "normal" \| "auto" \| "bypass" }` |
| `POST` | `/sessions/:id/profile` | Swap the live session to `{ "profile_id": "..." }` |
| `POST` | `/sessions/:id/credentials` | Set a custom API key (in-memory only) |
| `DELETE` | `/sessions/:id/credentials` | Revert to Garage defaults |
| `GET` | `/sessions/:id/files` | List files in the session's `uploads/` folder |
| `POST` | `/sessions/:id/files` | Upload file(s) into `uploads/` (`multipart/form-data`) |
| `GET` | `/sessions/:id/files/:path` | Download a file from `uploads/` (binary) |
| `DELETE` | `/sessions/:id/files/:path` | Delete a file from `uploads/` |
| `GET` | `/workspaces` | List first-class workspaces |
| `POST` | `/workspaces` | Create a workspace (mints a folder under `workspaceRoot` when `path` is omitted) |
| `GET` | `/workspaces/:id` | Workspace detail + its sessions |
| `DELETE` | `/workspaces/:id[?sessions=true]` | Remove a workspace (optionally its sessions) |
| `POST` | `/workspaces/:id/sessions` | Create a session inside the workspace |
| `POST` | `/workspaces/:id/mcp` | Install/refresh an MCP provider (code-as-tools) |
| `GET` | `/workspaces/:id/mcp` | List installed MCP providers (tokens redacted) |
| `POST` | `/workspaces/:id/mcp/sync` | Re-introspect + sync all providers |
| `POST` | `/workspaces/:id/mcp/:provider/sync` | Sync one provider |
| `DELETE` | `/workspaces/:id/mcp/:provider` | Remove one provider |
| `GET` | `/templates`, `/templates/:name` | Setup templates |
| `GET` | `/models/providers`, `/models/profiles` | Configured models (keys redacted) |
| `POST` | `/models/profiles/:id/activate` | Set the Garage-wide default profile |
| `POST` | `/namespaces` | Provision a tenant namespace (admin) |
| `GET` | `/namespaces` | List namespaces (admin; always includes `default`) |
| `GET` | `/namespaces/:id` | Namespace detail + session count (admin) |
| `DELETE` | `/namespaces/:id[?data=true]` | Deprovision a namespace (admin) |
| `POST` | `/namespaces/:id/keys` | Mint a namespace-bound API key (admin) |
| `GET` | `/namespaces/:id/keys` | List a namespace's keys (admin) |
| `GET` | `/health` | Health check |

### `POST /sessions` body

```jsonc
{
  "workspace": "/home/dev/my-app",   // existing dir; omit to auto-create under workspaceRoot
  "template": "next-app",            // OR provision from a template (with params)
  "params": { "repo": "github.com/me/my-repo" },
  "provider": "anthropic",           // optional per-session overrides
  "model": "claude-sonnet-4-20250514",
  "profileId": "anthropic__claude-...", // pre-configured profile to use
  "permissionMode": "normal",        // normal | auto | bypass
  "credentials": {                   // optional per-session custom key (never persisted)
    "provider": "anthropic",
    "apiKey": "sk-ant-...",
    "model": "claude-sonnet-4-20250514"
  }
}
```

### `POST /sessions/:id/messages` body

```jsonc
{
  "text": "Add rate limiting to the API routes",
  "wait": false,         // true = block and return the full turn (for CI); false = fire-and-forget, watch WS
  "timeout_ms": 120000,  // wait-mode only
  "auto_approve": true,  // wait-mode only: auto-approve permission prompts
  "images": [{ "data": "<base64>", "media_type": "image/png" }]
}
```

Fire-and-forget returns `202 { accepted: true }`; `wait:true` returns the collected turn (`text`, `tools`, `error`, …).

### `POST /sessions/:id/slots/:slotId` body

```jsonc
{ "action": "approve" }   // approve | deny | resolve | reject
// resolve takes "value": <any>; reject takes "reason": "..."
```

### Exchanging files

Each session has a dedicated **`uploads/` folder inside its workspace** (the name
is configurable via `filesDir` in `garage.json`). It's the shared hand-off point
between you and the agent: drop input files in for the agent to read, and the
agent writes any file deliverable you ask for (`.pptx`, `.docx`, `.zip`, exports)
back into it for you to download. Paths are confined to that folder — a `..`
traversal is rejected with `400`.

```bash
id=...   # a session id

# Upload a file the agent should work on
curl -s -F file=@./brief.pdf localhost:4271/sessions/$id/files

# Ask the agent to produce something, then list what's there
curl -s localhost:4271/sessions/$id/files
# → { "files": [ { "path": "deck.pptx", "size": 48211, "modified_at": "..." } ] }

# Download a generated file
curl -s localhost:4271/sessions/$id/files/deck.pptx -o deck.pptx

# Delete it
curl -s -X DELETE localhost:4271/sessions/$id/files/deck.pptx
```

With the `@porkytheblack/glorp-client` kit:

```ts
await client.sessions.uploadFile(id, new Blob([buf]), "brief.pdf");
const { files } = await client.sessions.files(id);
const bytes = await client.sessions.downloadFile(id, "deck.pptx"); // Uint8Array
await client.sessions.deleteFile(id, "deck.pptx");
```

---

## WebSocket

Connect to `GET /sessions/:id/events` (upgrade to WS). On connect you receive a `session_hydrate` event with full state, then a live stream. Every message is wrapped:

```jsonc
{ "sessionId": "...", "seq": 42, "event": { "type": "text_delta", "text": "..." } }
```

`seq` is monotonic per client — a gap means you missed events (reconnect or send a `resync` command to re-hydrate). Multiple clients can subscribe to the same session.

You can also push commands back over the socket (clients can use both REST and this):

```jsonc
{ "type": "send_message", "text": "..." }
{ "type": "abort" }
{ "type": "resolve_permission", "slot_id": "...", "allow": true }
{ "type": "set_permission_mode", "mode": "auto" }
{ "type": "resync" }
```

---

## Setup templates

Templates provision a fresh workspace before the agent starts. Put JSON files in `<data-dir>/templates/` — the filename is the template name.

`~/.glorp/templates/next-app.json`:

```json
{
  "description": "Clone a repo and install deps",
  "steps": [
    { "type": "git-clone", "repo": "https://{env:GH_TOKEN}@github.com/{param:repo}.git", "ref": "main" },
    { "type": "shell", "command": "bun install" },
    { "type": "copy", "from": "/home/dev/templates/glorp.json", "to": "glorp.json" }
  ]
}
```

- Step types: `git-clone` (`repo`, optional `dest`, `ref`), `shell` (`command`), `copy` (`from`, `to`).
- Interpolation: `{param:NAME}` from the create request's `params`, `{env:VAR}` from Garage's environment. Interpolated values (potential secrets) are scrubbed from error messages.
- Steps run sequentially; on any failure the workspace is cleaned up and creation fails.

### Runtime environment variables (`env`)

A template's **`env`** map is exported into the worker's runtime, so the agent
(and every `bash` command it runs) reads them as ordinary environment variables
— no `export` boilerplate, no shell step. Each value is interpolated
(`{param:NAME}` / `{env:VAR}`) and written, shell-quoted, into the workspace's
`.glorp/gh-env.sh` script, which `BASH_ENV` sources before every command.

```json
{
  "description": "A task with prefilled, isolated env",
  "params": [{ "name": "STRIPE_KEY", "required": true, "secret": true }],
  "env": {
    "STRIPE_KEY": "{param:STRIPE_KEY}",
    "API_BASE": "https://api.example.com",
    "DEPLOY_REGION": "{env:DEPLOY_REGION}"
  }
}
```

- **Cleanly isolated** — the script lives in *this* task's workspace and nowhere
  else, so one task's env can never leak into another's (the host process env is
  never mutated).
- **Secret-safe** — a value's secrecy is inherited from any `secret` param it
  references; interpolated values are scrubbed from error messages and never
  logged. Names must be valid shell identifiers (`[A-Za-z_][A-Za-z0-9_]*`).
- An external service that submits a task just passes the values as `params`;
  the template maps them into `env`. For infra secrets the submitter shouldn't
  even see, use operator-managed params (`GLORP_GARAGE_TASK_PARAM_*`, see
  [tasks.md](./tasks.md)) and reference them the same way.

> Integrating `env` into a template? See the focused
> [template `env` quick guide](./template-env.md) — shape, rules, guarantees, and gotchas.

Create from a template:

```bash
curl -s -X POST localhost:4271/sessions \
  -H 'content-type: application/json' \
  -d '{"template":"next-app","params":{"repo":"me/my-repo"}}'
```

---

## MCP workspaces

Provision a workspace with **external MCP tools as code**, then drive it with plain
prompts. Glorp introspects the MCP server, deterministically generates one typed
wrapper per tool into the workspace, and writes a `0600` keyfile. The agent calls the
tools and self-authenticates **at call time** — tokens never enter the model's context.
See [`../src/mcpgen/README.md`](../src/mcpgen/README.md) for the generated layout.

```bash
# 1. Create a workspace (mints a managed folder under workspaceRoot).
WS=$(curl -s -X POST localhost:4271/workspaces \
  -H 'content-type: application/json' -d '{"name":"acme"}' | jq -r .id)

# 2. Install an MCP provider, with one or more named identities.
curl -s -X POST "localhost:4271/workspaces/$WS/mcp" \
  -H 'content-type: application/json' -d '{
    "provider": "linear",
    "url": "https://mcp.linear.com",
    "defaultIdentity": "acme",
    "identities": [
      { "name": "acme", "token": "lin_...", "label": "Acme Corp" },
      { "name": "personal", "token": "lin_..." }
    ]
  }'
# → { "provider":"linear", "added":["create_issue", ...], "removed":[], "changed":[], "unchanged":0 }

# 3. Thereafter: create sessions in the workspace and just send prompts.
curl -s -X POST "localhost:4271/workspaces/$WS/sessions" \
  -H 'content-type: application/json' -d '{}'
```

- **Identities** — a provider can hold several named tokens (e.g. multiple Linear
  workspaces). A call targets one via the generated wrapper's `{ identity }` argument,
  else the configured default, else the first. Names + labels are public
  (`mcp/identities.json`); tokens stay in `.secrets/keys.json` and are never returned.
- **Update** — `POST /workspaces/:id/mcp/sync` re-introspects every provider (fail-soft
  per provider); `…/mcp/:provider/sync` does one. Regeneration is deterministic, so an
  unchanged sync rewrites nothing. Each call returns an `{ added, removed, changed, unchanged }` diff.
- **Remove** — `DELETE /workspaces/:id/mcp/:provider`.

---

## Per-session custom API keys

A session can use its own key instead of the Garage default:

```bash
curl -s -X POST localhost:4271/sessions/<id>/credentials \
  -H 'content-type: application/json' \
  -d '{"provider":"anthropic","apiKey":"sk-ant-...","model":"claude-sonnet-4-20250514"}'

curl -s -X DELETE localhost:4271/sessions/<id>/credentials   # revert to Garage default
```

The key is held **in memory only** — never written to disk, never logged, never returned by the API (responses show only `provider` + last-4). Re-supply it after a Garage restart if needed.

---

## CI / automation recipe

```bash
BASE=http://127.0.0.1:4271
ID=$(curl -s -X POST $BASE/sessions -H 'content-type: application/json' \
       -d '{"workspace":"'"$PWD"'","permissionMode":"bypass"}' | jq -r .id)

curl -s -X POST $BASE/sessions/$ID/messages -H 'content-type: application/json' \
  -d '{"text":"Run the test suite and fix any failures","wait":true,"timeout_ms":600000}' | jq .

curl -s -X DELETE "$BASE/sessions/$ID?workspace=false"
```
