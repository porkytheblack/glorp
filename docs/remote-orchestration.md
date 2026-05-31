# Remote orchestration

Drive Glorp Station from another machine — create workspaces and run agents over
an API-key-secured HTTP/WS API. This is the path for wiring Glorp into your own
orchestration (cron jobs, CI, a `station-signal` job, etc.).

- **HTTP/WS contract:** [`openapi.yaml`](./openapi.yaml) — works from any language.
- **TypeScript client:** [`@porkytheblack/glorp-client`](../packages/glorp-client/README.md).

## 1. Run Station with auth, reachable on the network

Bind a non-loopback host and Station **requires an API key automatically**:

```bash
glorp station --host 0.0.0.0 --port 4271
```

> Binding `0.0.0.0` (or any non-loopback address) flips auth on. On `127.0.0.1`
> auth stays off for local dev. Force it either way with `GLORP_STATION_AUTH=required|off`.

Mint a key (printed once — store it now):

```bash
glorp station keys add ci-bot --scopes admin
#  -> glsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
glorp station keys list
glorp station keys revoke <id>
```

Scopes: `admin` (everything, incl. key management), `run` (create/run sessions),
`read` (GET only). `admin` implies the rest.

### TLS

`Bun.serve` here speaks plain HTTP. For anything crossing a network, terminate
TLS at a reverse proxy (Caddy/nginx) in front of Station and talk `https://` /
`wss://`. Example (Caddy):

```
glorp.example.com {
  reverse_proxy 127.0.0.1:4271
}
```

Then run Station on `--host 127.0.0.1` and let the proxy face the internet.

## 2. Call it (any language)

```bash
EP=https://glorp.example.com KEY=glsk_xxx

# create a workspace from a folder on the Station host
curl -s -X POST $EP/api/v1/workspaces \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"path":"/srv/projects/acme"}'

# create a session in it (auto mode so it won't block on permission prompts)
curl -s -X POST $EP/api/v1/workspaces/<workspace_id>/sessions \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"permissionMode":"auto"}'

# send the first prompt (async)
curl -s -X POST $EP/api/v1/sessions/<id>/messages \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"text":"Add a health endpoint and a test."}'

# poll until the run finishes, then read the answer
curl -s $EP/api/v1/sessions/<id>/result -H "authorization: Bearer $KEY"
# { "status":"idle", "busy":false, "text":"Done — added /health …", "turn_count":1 }
```

Stream events live over WebSocket (the key goes in the query string because
browsers can't set WS headers):

```
wss://glorp.example.com/api/v1/sessions/<id>/events?api_key=glsk_xxx
```

Each frame is `{ "sessionId", "seq", "event" }`; watch `event.type === "busy"`
going `false` for turn completion, `text_delta` for streaming output, and
`error` for failures.

## 3. Or use the TypeScript kit

```ts
import { configure, run } from "@porkytheblack/glorp-client";

configure({ endpoint: "https://glorp.example.com", apiKey: process.env.GLORP_API_KEY });

const handle = await run({
  workspace: "/srv/projects/acme",   // or workspaceId: "ws_…"
  prompt: "Add a health endpoint and a test.",
  // permissionMode defaults to "auto"; use "bypass" for zero prompts.
});

for await (const ev of handle.events()) {
  if (ev.type === "text_delta") process.stdout.write(ev.text);
}
const { text } = await handle.result();
```

`configure` also auto-reads `GLORP_ENDPOINT` / `GLORP_API_KEY` from the
environment, so you can skip it entirely in a configured deployment.

## Headless permission modes (important)

Unattended runs must **not** use `permissionMode: "normal"` — the agent will block
forever waiting for a human to approve a tool. Use:

- `"auto"` (default for `run()`): auto-approve safe operations, escalate only
  genuinely destructive ones (which, headless, means they're refused).
- `"bypass"`: approve everything (still honors the hard-block guard for
  `rm -rf /`, `sudo`, etc.). Use only on disposable workspaces.

## Key rotation

Keys are stored hashed (sha256) at `<dataDir>/glorp-keys.json` (`0600`). To
rotate: `keys add` a new one, update your clients, then `keys revoke <old-id>`.
For multiple processes or a database-backed store, supply a custom
`ApiKeyStorageAdapter` via `defineConfig({ auth: { keyStorage } })` (a
`SqliteKeyStorage` ships in `src/station/auth`).
