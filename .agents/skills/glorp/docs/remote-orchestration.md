# Remote orchestration

Drive Glorp Garage from another machine — create workspaces and run agents over
an API-key-secured HTTP/WS API. This is the path for wiring Glorp into your own
orchestration (cron jobs, CI, a `station-signal` job, etc.).

- **HTTP/WS contract:** [`openapi.yaml`](./openapi.yaml) — works from any language.
- **TypeScript client:** [`@porkytheblack/glorp-client`](./glorp-client.md).

## 1. Run Garage with auth, reachable on the network

Bind a non-loopback host and Garage **requires an API key automatically**:

```bash
glorp garage --host 0.0.0.0 --port 4271
```

> Binding `0.0.0.0` (or any non-loopback address) flips auth on. On `127.0.0.1`
> auth stays off for local dev. Force it either way with `GLORP_GARAGE_AUTH=required|off`.

Mint a key (printed once — store it now):

```bash
glorp garage keys add ci-bot --scopes admin
#  -> glsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
glorp garage keys list
glorp garage keys revoke <id>
```

Scopes: `admin` (everything, incl. key management), `run` (create/run sessions),
`read` (GET only). `admin` implies the rest.

### TLS

`Bun.serve` here speaks plain HTTP. For anything crossing a network, terminate
TLS at a reverse proxy (Caddy/nginx) in front of Garage and talk `https://` /
`wss://`. Example (Caddy):

```caddyfile
glorp.example.com {
  reverse_proxy 127.0.0.1:4271
}
```

Then run Garage on `--host 127.0.0.1` and let the proxy face the internet.

## 2. Call it (any language)

```bash
EP=https://glorp.example.com KEY=glsk_xxx

# create a workspace from a folder on the Garage host
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

```text
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

## Multi-tenant namespaces

Hosting more than one user on a Garage? Give each their own **namespace** — an
isolated data partition with its own sessions, workspaces, sandboxes, and model
credentials. A namespace's data lives under `<dataDir>/namespaces/<id>/` and its
sandboxes under `<workspaceRoot>/<id>/`; one tenant's sessions are physically
invisible to another's.

Your orchestrator holds an **admin** key and provisions namespaces, minting a
namespace-bound key per user. That tenant key transparently scopes every call —
the user just talks to `/sessions`, `/workspaces`, etc. as usual and only ever
sees their own data. (Namespaces require auth on — bind a non-loopback host or
`GLORP_GARAGE_AUTH=required`.)

```bash
EP=https://glorp.example.com ADMIN=glsk_admin_xxx

# 1. Provision a namespace for a user (admin key)
curl -s -X POST $EP/api/v1/namespaces \
  -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"name":"acme"}'
#  -> { "id":"ns_acme", "slug":"acme", "is_default":false, ... }

# 2. Mint a key bound to that namespace (returned once)
curl -s -X POST $EP/api/v1/namespaces/ns_acme/keys \
  -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"name":"acme-bot"}'
#  -> { "data": { "key":"glsk_tenant_xxx", "namespace":"ns_acme", "scopes":["run","read"] } }

# 3. The tenant uses ITS key — all calls are auto-scoped to ns_acme
TENANT=glsk_tenant_xxx
curl -s -X POST $EP/api/v1/sessions \
  -H "authorization: Bearer $TENANT" -H 'content-type: application/json' \
  -d '{"permissionMode":"auto"}'
curl -s $EP/api/v1/sessions -H "authorization: Bearer $TENANT"   # only acme's sessions
```

The orchestrator can also act **inside** any namespace with its admin key by
sending the `X-Glorp-Namespace` header (or `?ns=<id>` on the WebSocket, since
browsers can't set headers there):

```bash
curl -s $EP/api/v1/sessions \
  -H "authorization: Bearer $ADMIN" -H 'x-glorp-namespace: ns_acme'
```

Each namespace optionally carries its own model-provider credentials (POST
`/models/providers` + `/models/profiles` with a tenant key), falling back to the
garage's defaults when unset — so each user can bring their own billing.

Deprovision when a user leaves. This revokes the namespace's keys, stops its live
sessions, and (with `?data=true`) deletes its data subtree and sandboxes. The
`default` namespace can never be deleted:

```bash
curl -s -X DELETE "$EP/api/v1/namespaces/ns_acme?data=true" -H "authorization: Bearer $ADMIN"
```

Mint a bound key offline (no running server) with the CLI:

```bash
glorp garage keys add acme-bot --namespace ns_acme   # scopes default to run,read
```

The TypeScript kit exposes this too — `client.namespaces.{create,list,get,delete,createKey,listKeys}`,
and `client.forNamespace("ns_acme")` (or `run({ namespace })`) for admin proxying.
See the [client README](./glorp-client.md#multi-tenancy-namespaces).

## 4. Or expose it over MCP

To let an MCP-capable agent (Claude Desktop/Code, Cursor, a custom orchestrator)
drive a Garage as tools, run [`@porkytheblack/glorp-mcp`](./glorp-mcp.md)
— an MCP server wrapping the kit, with stdio and streamable-HTTP transports:

```bash
GLORP_ENDPOINT=$EP GLORP_API_KEY=$KEY npx @porkytheblack/glorp-mcp          # stdio
GLORP_ENDPOINT=$EP GLORP_API_KEY=$KEY npx @porkytheblack/glorp-mcp --http   # POST /mcp
```

It exposes the full surface as `glorp_*` tools (namespaces, workspaces, sessions,
agent roster). Full guide: [`mcp.md`](./mcp.md).

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
`SqliteKeyStorage` ships in `src/garage/auth`).
