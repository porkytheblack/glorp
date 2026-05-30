# Glorp Station — Usage Guide

> **Naming note.** "Glorp Station" here is the **multi-session runtime** (`glorp station`) — a long-running server that hosts many agent sessions over a REST + WebSocket API. It is *not* the same as the `station-signal` async **fleet** runner mentioned elsewhere in the README (which runs background fan-out jobs in child processes). Two different things that happen to share the word "station".

Station lets you run multiple Glorp agents at once, leave them running, and connect from any client — a web dashboard, an IDE extension, a CLI, or a CI pipeline. See [`station-spec.md`](./station-spec.md) for the product spec and rationale.

---

## Quick start

```bash
# Credentials: Station inherits your global ~/.glorp config (run `glorp` once to onboard),
# or set an env var: export ANTHROPIC_API_KEY=... (or OPENAI_API_KEY, OPENROUTER_API_KEY, ...)

glorp station                 # REST + WS API on http://127.0.0.1:4271
glorp station --dashboard     # also serve the web dashboard at http://127.0.0.1:4271/
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
  --dashboard             Serve the Glorp Dashboard SPA at /
  --provider <name>       Default provider for new sessions
  -m, --model <name>      Default model for new sessions
  --auto-mode             Default permission mode: auto (approve safe ops)
  --bypass                Default permission mode: bypass (no prompts)
```

> Station binds to `127.0.0.1` by default and ships **no authentication** (v1). Browser requests are limited to same-origin or loopback origins, but non-browser clients on the host can still call the API. Run it on a trusted machine, or put it behind a reverse proxy / SSH tunnel if you need remote access.

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
  "permissionMode": "normal",
  "dashboard": true
}
```

---

## REST API

All paths are bare (no `/api/v1` prefix). JSON in, JSON out.

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
| `GET` | `/templates`, `/templates/:name` | Setup templates |
| `GET` | `/models/providers`, `/models/profiles` | Configured models (keys redacted) |
| `POST` | `/models/profiles/:id/activate` | Set the Station-wide default profile |
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

---

## WebSocket

Connect to `GET /sessions/:id/events` (upgrade to WS). On connect you receive a `session_hydrate` event with full state, then a live stream. Every message is wrapped:

```jsonc
{ "sessionId": "...", "seq": 42, "event": { "type": "text_delta", "text": "..." } }
```

`seq` is monotonic per client — a gap means you missed events (reconnect or send a `resync` command to re-hydrate). Multiple clients can subscribe to the same session.

You can also push commands back over the socket (the dashboard uses both REST and this):

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

## The dashboard

A web UI that consumes the same REST + WS API.

**With the compiled binary** (`glorp` on your PATH): `bun run build` now builds the dashboard too, and `bun run install-bin` copies the assets to `<data-dir>/dashboard` (default `~/.glorp/dashboard`) — the single-file binary can't read them from inside itself, so they live next to your state.

```bash
bun run build && bun run install-bin   # builds dashboard + CLI, installs both
glorp station --dashboard              # open http://127.0.0.1:4271/
```

**From source / npm install:** assets are found automatically (next to `dist/dashboard`).

Station probes, in order: `$GLORP_DASHBOARD_DIR`, `<data-dir>/dashboard`, the source/npm `dist/dashboard`, then next to the executable. If `--dashboard` is set but no assets are found, the startup log lists every path it checked. Point it anywhere explicitly with:

```bash
GLORP_DASHBOARD_DIR=/path/to/dist/dashboard glorp station --dashboard
```

**Local development** with hot reload (proxies the API/WS to a running Station):

```bash
glorp station                     # API on :4271 in one terminal
bun run dashboard:dev             # Vite dev server on :5173 in another
# override the API target: STATION_URL=http://127.0.0.1:4271 bun run dashboard:dev
```

The dashboard is also shipped pre-built in the npm package, so installs from npm work without a build step.

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
