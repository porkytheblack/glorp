---
name: glorp
description: Guide for downstream coding agents driving Glorp — especially Glorp Station (the remote multi-session control plane) and its sandboxes (Station-provisioned workspaces). Use when programmatically creating sessions, running coding agents over the REST/WebSocket API or the @porkytheblack/glorp-client SDK, provisioning sandboxes from templates, exchanging files, or wiring Glorp into CI/orchestration.
---

# Driving Glorp & Glorp Station

You are an agent working *with* Glorp programmatically — not the Glorp TUI user. This
skill tells you how to start a Station, create sessions, run coding agents inside
**sandboxes**, and collect their results, safely and without deadlocking.

**Glorp** is a coding agent (read/write/edit/bash/glob/grep/ls/web_fetch, subagents,
a mesh for fan-out). You can run it three ways:

| Mode | Command | Use when |
|---|---|---|
| **TUI** | `glorp` | A human is driving interactively. Not your path. |
| **Headless one-shot** | `glorp -p "…"` | One prompt, one workspace, exits when done. |
| **Station** | `glorp station` | You need *many* concurrent, long-lived, remotely-driven sessions. **This is your path for orchestration.** |

> **Two unrelated "stations".** "Glorp **Station**" (this skill) is the multi-session
> HTTP/WS control plane. It is *not* the `station-signal` fleet runner. Don't conflate them.

---

## Core model: sessions, workspaces, sandboxes

- A **session** is one running Glorp agent with its own conversation, plan, tasks, and
  permission state. State: `provisioning → idle ⇄ busy → (error) → destroyed`.
- A **workspace** is the directory the agent reads and edits. Two kinds:
  - **Caller-supplied workspace** — an existing host directory you point at
    (`"workspace": "/abs/path"`). Station **never deletes** these.
  - **Sandbox** — a workspace Station *provisions itself* under `workspaceRoot`
    (default `<data-dir>/workspaces`). Created when you omit `workspace`, or when you
    provision from a `template`. Station may clean these up. **Sandboxes are the safe
    target for `bypass`/`auto` unattended runs and disposable work.**

The distinction matters for cleanup: `DELETE /sessions/:id?workspace=true` removes the
folder **only if it is a Station-provisioned sandbox under `workspaceRoot` that no other
session references.** Caller-supplied and shared workspaces are always kept. So you can
safely cascade-delete a sandbox without risking a user's real repo.

---

## Start a Station

```bash
glorp station                       # REST + WS on http://127.0.0.1:4271 (loopback, auth OFF)
glorp station --host 0.0.0.0        # remote-reachable → auth REQUIRED automatically
glorp station --workspace-root /srv/sandboxes   # where sandboxes get provisioned
```

- Loopback (`127.0.0.1`) binds are **open**; any non-loopback bind **requires an API key**.
  Force either way with `GLORP_STATION_AUTH=required|off`.
- Credentials for the agents themselves come from `~/.glorp` config or env vars
  (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …).
- Persistent config: a `station.json` in the data dir (CLI flags override it).
- Every endpoint is served at both `/api/v1/…` (stable) and the bare root. Prefer
  `/api/v1` for anything durable.

### Auth (non-loopback)

```bash
glorp station keys add ci-bot --scopes admin   # prints the raw glsk_… key ONCE — capture it
glorp station keys list
glorp station keys revoke <id>
```

Send it as `Authorization: Bearer glsk_…` on REST, or `?api_key=glsk_…` on the WebSocket
(browsers can't set WS headers). Scopes: `admin` > `run` > `read`. `/health` is always open.

---

## Recommended: the typed SDK

Prefer [`@porkytheblack/glorp-client`](../../../packages/glorp-client/README.md) over raw
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
# (add  -H "authorization: Bearer glsk_…"  on any non-loopback Station)

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

Key endpoints (full table in [`docs/station-usage.md`](../../../docs/station-usage.md),
contract in [`docs/openapi.yaml`](../../../docs/openapi.yaml)):

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
- Interpolation: `{param:NAME}` from the request `params`, `{env:VAR}` from Station's env.
  Interpolated values are scrubbed from error messages (secret-safe).
- Steps run sequentially. **On any failure the sandbox is torn down and creation fails** —
  you never get a half-provisioned workspace. (Only a Station-created dir is removed; a
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
+ last-4). Re-supply after a Station restart.

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

- [`docs/station-usage.md`](../../../docs/station-usage.md) — full usage guide (CLI, REST, WS, templates)
- [`docs/openapi.yaml`](../../../docs/openapi.yaml) — the machine-readable contract
- [`docs/remote-orchestration.md`](../../../docs/remote-orchestration.md) — driving Station remotely
- [`docs/codebase/station-internals.md`](../../../docs/codebase/station-internals.md) — how Station works under the hood
- [`docs/codebase/networking.md`](../../../docs/codebase/networking.md) — server/client/protocol/SDK internals
- [`packages/glorp-client/README.md`](../../../packages/glorp-client/README.md) — the typed SDK
