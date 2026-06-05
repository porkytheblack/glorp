# Glorp Station — Usage Guide

> **Naming note.** "Glorp Station" here is the **multi-session runtime** (`glorp station`) — a long-running server that hosts many agent sessions over a REST + WebSocket API. It is *not* the same as the `station-signal` async **fleet** runner mentioned elsewhere in the README (which runs background fan-out jobs in child processes). Two different things that happen to share the word "station".

Station lets you run multiple Glorp agents at once, leave them running, and connect from any client — an IDE extension, a CLI, or a CI pipeline. See [`station-spec.md`](./station-spec.md) for the product spec and rationale.

---

## Quick start

```bash
# Credentials: Station inherits your global ~/.glorp config (run `glorp` once to onboard),
# or set an env var: export ANTHROPIC_API_KEY=... (or OPENAI_API_KEY, OPENROUTER_API_KEY, ...)

glorp station                 # REST + WS API on http://127.0.0.1:4271
```

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
glorp station [options]

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

> Station binds to `127.0.0.1` by default. A **non-loopback bind requires an API key automatically** (see [Authentication & remote access](#authentication--remote-access) below) — never expose Station on a public interface without it. On loopback, same-origin/loopback browser requests are allowed and non-browser clients on the host can still reach the API, so only run it on a trusted machine or behind a reverse proxy / SSH tunnel.

### `station.json`

Drop a `station.json` in the data dir for persistent config (CLI flags win over it):

```json
{
  "hostname": "127.0.0.1",
  "port": 4271,
  "workspaceRoot": "/home/dev/glorp-workspaces",
  "templatesDir": "/home/dev/.glorp/templates",
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "permissionMode": "normal"
}
```

---

## Authentication & remote access

Station is **open on loopback** (localhost dev) and **requires an API key on any
non-loopback bind** — so `glorp station --host 0.0.0.0` is auth-protected by
default. Force it either way with `GLORP_STATION_AUTH=required|off`.

```bash
glorp station keys add ci-bot --scopes admin   # prints the key once (glsk_…)
glorp station keys list
glorp station keys revoke <id>
```

Send the key as `Authorization: Bearer glsk_…` (REST) or `?api_key=glsk_…` (the
WebSocket, which can't set headers from a browser). `/health` stays open.

### Multi-tenant namespaces

Run one Station for many users by giving each an isolated **namespace** (its own
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

glorp station keys add acme-bot --namespace ns_acme   # ...or mint one offline via CLI
```

Admin keys can act inside any namespace with the `X-Glorp-Namespace: <id>` header
(`?ns=<id>` on the WebSocket). Deprovision with `DELETE /namespaces/:id?data=true`.
Full walkthrough in [`remote-orchestration.md`](./remote-orchestration.md).

For driving Station from another machine or your own orchestration, see
[`remote-orchestration.md`](./remote-orchestration.md), the OpenAPI contract in
[`openapi.yaml`](./openapi.yaml), and the typed client
[`@porkytheblack/glorp-client`](./glorp-client.md).

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
| `DELETE` | `/sessions/:id/credentials` | Revert to Station defaults |
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
| `POST` | `/models/profiles/:id/activate` | Set the Station-wide default profile |
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
is configurable via `filesDir` in `station.json`). It's the shared hand-off point
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
- Interpolation: `{param:NAME}` from the create request's `params`, `{env:VAR}` from Station's environment. Interpolated values (potential secrets) are scrubbed from error messages.
- Steps run sequentially; on any failure the workspace is cleaned up and creation fails.

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
See `src/mcpgen/README.md` in the glorp repository for the generated layout.

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

A session can use its own key instead of the Station default:

```bash
curl -s -X POST localhost:4271/sessions/<id>/credentials \
  -H 'content-type: application/json' \
  -d '{"provider":"anthropic","apiKey":"sk-ant-...","model":"claude-sonnet-4-20250514"}'

curl -s -X DELETE localhost:4271/sessions/<id>/credentials   # revert to Station default
```

The key is held **in memory only** — never written to disk, never logged, never returned by the API (responses show only `provider` + last-4). Re-supply it after a Station restart if needed.

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
