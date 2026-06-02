# Networking & Client SDK

This document is a technical reference for Glorp's networking subsystem: the
local agent server, the wire protocol it speaks, the in-repo client, and the
standalone published `@porkytheblack/glorp-client` SDK.

> Scope note: this covers `src/server/`, `src/client/`, `src/protocol/`,
> `packages/glorp-client/`, and `src/cli-serve.ts`. The Station control plane
> (`src/station/`) is documented separately; it is referenced here only where it
> overlaps (the standalone SDK actually targets the Station API, see
> [Two servers, two protocols](#two-servers-two-protocols)).

## Overview

Glorp exposes a coding agent over the network as a single `Bun.serve()` process
that speaks both HTTP (REST) and WebSocket. The split of responsibilities is:

- **`src/protocol/`** — the shared wire vocabulary: an `Envelope` shape, the
  client→server command union, the server→client event union, and the REST
  request/response DTOs. Both the server and the in-repo client import these
  types so the contract is defined exactly once.
- **`src/server/`** — the REST + WebSocket server. It owns one active agent
  session (`SessionPool`), relays the agent's `Bridge` events to every connected
  socket (`Broadcaster`), parses and dispatches commands (`ws-handler` +
  `dispatch`), and advertises itself via a discovery file on disk.
- **`src/client/`** — an in-repo TypeScript client (used by Glorp's own UI). It
  wraps the REST endpoints, manages the WebSocket lifecycle with auto-reconnect,
  and adapts server events back into the local `BridgeEvent` shape the UI store
  already understands.
- **`packages/glorp-client/`** — a separately published, zero-dependency SDK.
  Note that it targets the **Station** HTTP/WS API (workspaces, API keys), not
  the local server in `src/server/`.

Data flow for a live session:

```
GlorpHandle ──emit──> Bridge (singleton) ──subscribe──> Broadcaster
                                                              │ fan-out (per-client seq)
                                                              ▼
client command ──WS──> ws-handler ──dispatch──> GlorpHandle   WS clients
```

The server's REST surface manages session lifecycle and one-shot synchronous
runs; the WebSocket surface carries the live, streaming, bidirectional
conversation.

## Protocol layer (`src/protocol/`)

Everything on the wire that is shared between server and client lives here, and
the package's public surface is re-exported from `src/protocol/index.ts`.

### Envelope and constants (`src/protocol/envelope.ts`)

Every WebSocket message — both directions — extends `Envelope`
(`src/protocol/envelope.ts:11`):

```ts
interface Envelope { type: string; seq: number; ts: string }
```

- `type` — discriminator string.
- `seq` — monotonically increasing sequence number scoped to the connection.
  The server increments a **per-client** counter on send; the client increments
  its own counter on send. This lets a consumer detect a gap and request a
  resync.
- `ts` — ISO-8601 creation timestamp.

Also defined here:

- `PROTOCOL_VERSION = 1` (`envelope.ts:6`) — checked on both sides of the
  handshake; a mismatch closes the socket.
- `DEFAULT_PORT = 3271` (`envelope.ts:9`) — the local server's default port.
- `ServerDiscovery` (`envelope.ts:21`) — the shape written to
  `<dataDir>/server.json`.
- `ErrorResponse` (`envelope.ts:30`) — `{ error, message }`, the standard REST
  error body.
- `WS_CLOSE` (`envelope.ts:36`) — close codes: `NORMAL 1000`,
  `SERVER_SHUTDOWN 1001`, `NO_HELLO 4001`, `PING_TIMEOUT 4002`,
  `PROTOCOL_ERROR 4003`, `AUTH_FAILED 4004`, `SESSION_GONE 4005`,
  `VERSION_MISMATCH 4006`.

### Framing

Messages are newline-free JSON text frames. Outbound: the sender spreads the
payload and attaches `seq`/`ts` (e.g. `broadcast.ts:46`, `client.ts:171`).
Inbound: `JSON.parse` then a switch on `type`. There is no binary framing and no
length prefix — one WebSocket text message is one enveloped object.

### Commands — client → server (`src/protocol/commands.ts`)

`ClientMessage` (`commands.ts:124`) is the union of all command types. Each maps
1:1 to a `GlorpHandle` method and is **fire-and-forget** — there is no response
message, results come back as server events. The handshake command is
`ClientHello` (`commands.ts:15`), carrying `protocol_version`, `client_id`, and
optional `client_name`.

The command variants: `send_message` (with optional base64 `ImageAttachment[]`),
`plan_and_build`, `abort`, `resolve_slot`, `reject_slot`, `resolve_permission`,
`swap_profile`, `clear_permission`, `clear_permission_key`, `resync`,
`stop_agent`, `promote_agent`, `set_permission_mode` (`normal`/`auto`/`bypass`),
`switch_agent`, `add_agent`, `remove_agent`.

### Events — server → client (`src/protocol/events.ts`)

`ServerMessage` (`events.ts:128`) is the union of all server-pushed events. They
fall into three groups:

- **Connection lifecycle**: `server_hello` (`events.ts:43`, carries
  `protocol_version`, `server_version`, `session_id`, `workspace`, `peer_count`,
  optional `model_label`), `peer_joined`, `peer_left`.
- **Bridge relays** — the bulk of the union, mirroring `BridgeEvent` variants
  from `src/shared/events.ts` 1:1: `session_hydrate`, `session_reset`,
  `text_delta`, `text_clear`, `turn`, `turn_update`, `tool_started`,
  `tool_finished`, `busy`, `title`, `stats`, `compaction`, `plan`, `tasks`,
  `inbox`, `subagent`, `skill`, `hook`, `display_slot_pushed`,
  `display_slot_resolved`, the `orchestrator_*` family, `agent_roster`,
  `runner_agent_stats`, `transmission`, `error`. Data types (`ChatTurn`,
  `ToolEvent`, `PlanDocument`, etc.) are imported from and re-exported via
  `src/shared/events.ts` so clients only ever import from the protocol package.
- **Server-only events**: `model_label_changed`, `command_rejected`
  (references the offending `ref_seq`), `protocol_error`.

### REST shapes (`src/protocol/rest.ts`)

Typed request/response DTOs for the local server's REST API:
`HealthResponse`, `CreateSessionRequest`/`CreateSessionResponse` (the latter
includes the `ws_url` to connect to), `SessionInfoDto`, `ListSessionsResponse`,
`GetSessionResponse`, `ProfileSummary`/`ListProfilesResponse`, and the
synchronous message endpoint pair `SendMessageRequest`/`SendMessageResponse`.

`SendMessageRequest` (`rest.ts:68`) is notable for its defaults documented in the
type: `timeout_ms` (120 000), `auto_approve` (true), `cleanup_agents` (true).

## The server (`src/server/`)

### Entrypoint and routing (`src/server/server.ts`)

`startServer(config)` (`server.ts:55`) wires everything together and starts a
single `Bun.serve()` bound to `127.0.0.1` only — it is a local dev tool. It:

1. Constructs the `SessionPool`, `Broadcaster`, `CredentialsStore`, and the REST
   `router`.
2. Subscribes the broadcaster to the global `Bridge` so **every** agent event is
   fanned out to connected sockets (`server.ts:70`).
3. Serves three concrete path families in `fetch` (`server.ts:76`):
   - `POST /api/v1/sessions/:id/message` — the synchronous send-and-collect
     endpoint, handled by `handleSendMessage` (`server.ts:94`).
   - `GET /api/v1/sessions/:id/ws` with an `Upgrade: websocket` header — the
     WebSocket upgrade; resolves/creates the session, builds the `WsContext`,
     and calls `srv.upgrade(req, { data: makeWsData(ctx) })` (`server.ts:114`).
   - everything else → `routeRest` (`server.ts:170`).
4. Writes the discovery file and logs the listen address.

Cross-cutting request handling:

- **CORS** — permissive `*` headers for localhost; `OPTIONS` short-circuits with
  204 (`server.ts:44`, `server.ts:79`).
- **Auth** — optional. If `config.token` is set, every path except
  `/api/v1/health` requires `Authorization: Bearer <token>`, else 401
  (`server.ts:83`).
- **Shutdown** — `stop()` unsubscribes from the bridge, shuts down all sessions,
  stops the server, and removes the discovery file (`server.ts:160`).

`routeRest` (`server.ts:170`) maps methods/paths to router methods:
`GET /api/v1/health`, `POST|GET /api/v1/sessions`, `GET /api/v1/profiles`,
`GET|DELETE /api/v1/sessions/:id`. Unknown routes return a 404 JSON
`ErrorResponse`.

### REST handlers (`src/server/router.ts`)

`createRouter(pool, config, credentials)` (`router.ts:57`) returns an object of
handlers, all producing `src/protocol/rest.ts` shapes via the local `json` helper:

- `health()` — status, version, uptime, and `active_sessions` (pool size).
- `createSession(req)` — `pool.getOrCreate`; returns 201 if created else 200, and
  builds the `ws_url` `ws://127.0.0.1:<port>/api/v1/sessions/<id>/ws`
  (`router.ts:93`).
- `listSessions()` — reads sessions from disk scoped to the workspace.
- `getSession(id)` — returns live data from the pool if active (including
  `connected_clients` and `model_label`), otherwise falls back to a disk lookup
  (`router.ts:114`).
- `deleteSession(id)` — shuts down the live session if present, then deletes from
  disk; 204.
- `listProfiles()` — model profiles from the `CredentialsStore`.

### Session pool (`src/server/session-pool.ts`)

`SessionPool` enforces a **single-session model**: at most one active session at
a time. `getOrCreate` (`session-pool.ts:40`) returns the existing session if the
id matches, otherwise calls `shutdownAll()` to tear down any prior session before
calling `buildGlorp(...)` to construct a new `GlorpHandle`. Each `ActiveSession`
holds the handle, the shared `Bridge`, a `clients` set, and `createdAt`. The
global `Bridge` singleton is shared between the handle (producer) and the server
(consumer), which is why only one session can be live at once.

### WebSocket handler (`src/server/ws-handler.ts`)

Manages the connection lifecycle: `open → server_hello → client_hello → active`.

- `makeWsData(ctx)` (`ws-handler.ts:166`) creates the per-connection state Bun
  stores on `ws.data` — context, a generated anonymous `clientId`,
  `authenticated: false`, and a hello timer.
- `handleWsOpen` (`ws-handler.ts:43`) immediately sends `server_hello` (with
  `peer_count`, `model_label`, `permission_mode`) and arms a **5-second** timer;
  if `client_hello` hasn't arrived, the socket is closed with `NO_HELLO (4001)`.
- `handleWsMessage` (`ws-handler.ts:68`) parses JSON (bad JSON or a missing
  `type` → a `protocol_error` event), routes `client_hello` to the handshake, and
  rejects any other command before authentication with `PROTOCOL_ERROR (4003)`.
  Authenticated commands go to `dispatchCommand`.
- `handleClientHello` (`ws-handler.ts:111`) clears the timer, enforces
  `PROTOCOL_VERSION` (mismatch → `VERSION_MISMATCH (4006)`), registers the client
  with the broadcaster, broadcasts `peer_joined`, and triggers
  `handle.hydrateUi()` to push current state to the new client.
- `handleWsClose` (`ws-handler.ts:148`) removes the client and broadcasts
  `peer_left` (only if it had authenticated).

### Command dispatch (`src/server/dispatch.ts`)

`dispatchCommand(msg, handle)` (`dispatch.ts:8`) is a pure switch from each
`ClientMessage` variant to the corresponding `GlorpHandle` method (e.g.
`send_message → handle.send`, `resync → handle.hydrateUi`,
`set_permission_mode → handle.setPermissionMode`). No value is returned to the
caller; effects surface as bridge events.

### Broadcast / fan-out (`src/server/broadcast.ts`)

`Broadcaster` (`broadcast.ts:20`) keeps a `Map<id, WsClient>` where each client
carries its own `seq` counter.

- `broadcast(event)` (`broadcast.ts:42`) — converts a `BridgeEvent` to an
  enveloped message and sends to every open socket, incrementing each client's
  `seq` independently and sharing one `ts`.
- `sendTo(clientId, event)` — targeted send to a single client.
- `broadcastPeerEvent(type, originClientId)` (`broadcast.ts:71`) — notifies all
  **other** clients of a join/leave (the originator is skipped) with the current
  `peer_count`.

Sends to a non-`OPEN` socket are skipped, and send failures are swallowed — the
close handler is responsible for cleanup.

### Discovery (`src/server/discovery.ts`)

The server advertises itself by writing `<dataDir>/server.json` (a
`ServerDiscovery`) atomically (write to `.tmp`, then rename) on startup
(`discovery.ts:10`) and unlinking it on shutdown. `readDiscovery` parses it back
and validates that `port`/`pid` are numbers. (The client side has its own reader
that additionally checks the process is alive — see below.)

### Synchronous message endpoint (`src/server/message-endpoint.ts`)

`handleSendMessage(handle, bridge, body)` (`message-endpoint.ts:20`) backs
`POST /api/v1/sessions/:id/message`. It is designed for programmatic / headless
testing: it subscribes to the bridge, sends the message, and collects events
until the turn finishes, then resolves a structured `SendMessageResponse`.

- **Completion** is detected by observing `busy: true` followed by `busy: false`
  (`message-endpoint.ts:77`).
- It accumulates `turns`, streamed `text_delta`, `tools` (matched by id on
  finish), `subagents`, and `orchestrator_agents`; `error` events are captured.
- A `timeout_ms` (default 120 000) forces completion with an error.
- When `auto_approve` is set (default true), incoming permission display-slots
  are auto-resolved — deferred to a macrotask via `setTimeout(…, 0)` because the
  resolver isn't registered until after `pushAndWait`'s microtasks drain
  (`message-endpoint.ts:69`).
- When `cleanup_agents` is set (default true), any agents spawned during the turn
  that are still running are stopped afterward (`cleanupRunningAgents`,
  `message-endpoint.ts:109`).

The server returns HTTP 502 if there is an `error` and no `text`, otherwise 200
(`server.ts:101`).

### Public surface (`src/server/index.ts`)

Exports `startServer`, `ServerConfig`, `readDiscovery`, and the `ActiveSession`
type.

## The in-repo client (`src/client/`)

A TypeScript client used inside the Glorp repo (e.g. its own UI). Public exports
in `src/client/index.ts`: `GlorpClient`, `discoverServer`/`serverUrl`,
`serverMessageToBridgeEvent`.

### `GlorpClient` (`src/client/client.ts`)

A combined REST + WebSocket client.

- **Config** (`client.ts:16`): `url` (e.g. `http://127.0.0.1:3271`), `clientId`,
  optional `clientName`, optional bearer `token`, and `autoReconnect` (default
  true).
- **REST delegates** (`client.ts:54`) forward to `src/client/rest.ts`:
  `health`, `createSession`, `listSessions`, `getSession`, `deleteSession`,
  `listProfiles`.
- **State machine** (`client.ts:13`):
  `disconnected → connecting → handshaking → connected`. State changes are
  observable via `onStateChange`.
- **WebSocket lifecycle** (`client.ts:127`): on `open` it moves to
  `handshaking`; on the first `server_hello` it verifies `PROTOCOL_VERSION`
  (mismatch → close 4006), sends `client_hello`, and moves to `connected`. The
  `wsUrl` rewrites `http→ws` and appends `?token=` when a token is set
  (`client.ts:197`).
- **Reconnect** (`client.ts:188`): exponential backoff from 100 ms to 5 000 ms
  with ±25% jitter, reset on a successful handshake. `disconnect()` clears the
  reconnect intent and closes with 1000.
- **Commands** (`client.ts:103`): one typed method per command variant; each
  calls `sendCmd`, which no-ops unless the socket is `OPEN` and state is
  `connected`, then frames the payload with the next `seq`/`ts`.
- **Events**: `subscribe(fn)` registers a listener; listener exceptions are
  swallowed so one bad consumer can't break the stream (`client.ts:174`).

### REST helpers (`src/client/rest.ts`)

Thin typed `fetch` wrappers for each endpoint. `buildHeaders(token)`
(`rest.ts:17`) sets `Accept: application/json` and an optional bearer header.
Non-2xx responses throw an `Error` carrying the server's `ErrorResponse.message`
when available (`rest.ts:23`).

### Discovery reader (`src/client/discovery.ts`)

`discoverServer(dataDir?)` (`discovery.ts:17`) reads `<dataDir>/server.json`
(default `~/.glorp`), validates `port`/`pid`, and — unlike the server-side
reader — confirms the server process is alive via `process.kill(pid, 0)`,
returning `null` otherwise. `serverUrl(discovery)` builds
`http://127.0.0.1:<port>`.

### Bridge adapter (`src/client/bridge-adapter.ts`)

`serverMessageToBridgeEvent(msg)` (`bridge-adapter.ts:51`) converts an incoming
`ServerMessage` back into a local `BridgeEvent` so the existing UI store/reducer
can consume remote events unchanged. It only passes through types in the
`BRIDGE_TYPES` allow-list (`bridge-adapter.ts:11`); server-only messages
(`server_hello`, `peer_*`, `model_label_changed`, `command_rejected`,
`protocol_error`) return `null`. It strips the `seq`/`ts` envelope fields that
`BridgeEvent` doesn't carry.

## The standalone SDK (`packages/glorp-client/`)

A separately published, zero-runtime-dependency package
(`@porkytheblack/glorp-client`, `package.json`) that runs in Node 18+, Bun, and
the browser. **Important:** despite the shared name, it targets the **Station**
control-plane API (workspaces + API keys, default port 4271, served under
`/api/v1`), not the local `src/server/` API. Its types come from a vendored copy
of the Station contract, and its WS framing differs (see below).

### Usage

Two entry styles, both in `src/index.ts`:

- Top-level `configure()` + `run()` / `streamSession()` using a process-global
  default config.
- `createClient(opts)` for an explicit, namespaced client.

```ts
import { configure, run } from "@porkytheblack/glorp-client";
configure({ endpoint: "https://glorp.example.com", apiKey: "glsk_…" });
const handle = await run({ workspace: "/srv/project", prompt: "Fix the build" });
const { text } = await handle.result();
```

### Config (`packages/glorp-client/src/config.ts`)

`GlorpConfig` (`config.ts:8`): `endpoint`, optional `apiKey`, optional `fetch`
override, optional `WebSocketImpl`, optional `timeoutMs`. `configure()` stores a
normalized default (trailing slashes stripped); `resolveConfig(opts)`
(`config.ts:40`) resolves precedence **explicit opts → configured default → env**
(`GLORP_ENDPOINT` / `GLORP_API_KEY`), throwing a helpful error if nothing is
configured. `apiBase(cfg)` returns `<endpoint>/api/v1` (`config.ts:52`).

### `run` orchestration (`packages/glorp-client/src/run.ts`)

`runWith(cfg, opts)` (`run.ts:76`) creates a session (inside a workspace if
`workspaceId` given, else at an absolute `workspace` path), sends the first
prompt to `/sessions/:id/messages`, and returns a `RunHandle`. The handle exposes
`status()`, `events(onEvent)` (a `SessionStream`), `result(opts)`, and `abort()`.
`permissionMode` defaults to `"auto"` so unattended runs don't deadlock on a
permission prompt (`run.ts:43`). `result()` (`run.ts:60`) polls
`/sessions/:id/result` every `pollMs` (default 800) up to `timeoutMs` (default
600 000), returning when an error appears or when the run produced text / went
busy-then-idle with turns.

### Full client (`packages/glorp-client/src/client.ts`)

`createClient(opts)` (`client.ts:31`) returns a namespaced client over the
Station REST/WS API: `workspaces`, `sessions` (the largest namespace — create,
list, get, destroy, `sendMessage`/`sendMessageAndWait`, abort, permission mode,
profile, history, result, plan, tasks, multi-agent roster, permission grants, and
`uploads/` file exchange via `requestForm`/`requestBinary`), `models`, and
`keys`, plus the headline `run()` and `streamSession()`.

### REST transport (`packages/glorp-client/src/rest.ts`)

`request<T>` (`rest.ts:14`) is the low-level helper: JSON body, optional
`Authorization: Bearer <apiKey>`, optional `AbortSignal.timeout(timeoutMs)`, and
it unwraps a `{ data }` envelope when present (used by the keys routes) while
passing bare bodies through. `requestForm` handles multipart uploads (lets fetch
set the boundary), `requestBinary` returns a `Uint8Array`, and `ping`
(`rest.ts:82`) is a never-throwing liveness check against `/health`.

### WebSocket transport (`packages/glorp-client/src/ws.ts`)

`streamSessionWith(cfg, sessionId, onEvent)` (`ws.ts:15`) opens
`<ws-endpoint>/api/v1/sessions/:id/events`, passing the API key as a
`?api_key=` **query param** (a browser WS can't set headers). The endpoint path
(`/events`) and the auth mechanism differ from the in-repo server's `/ws` +
`?token=`. Each message is an `EventEnvelope` `{ sessionId, seq, event }`; the
inner `event` is delivered both to the `onEvent` callback and through an
async-iterator interface, so consumers can `for await (const ev of stream)`. A
`WebSocketImpl` from config is used when `globalThis.WebSocket` is absent.

### Wire contract & sync (`packages/glorp-client/src/contract.ts`, `scripts/sync-contract.ts`)

`contract.ts` is a **generated, self-contained, zero-import** copy of the Station
wire types (`SessionDto`, `SessionResult`, `WorkspaceDto`, `CreateSessionInput`,
`BridgeEvent`, `EventEnvelope`, etc.) so the published package vendors the
contract verbatim with no imports back into the app. The `BridgeEvent` type here
is an intentionally **open union** (`contract.ts:134`) — orchestration-relevant
variants are typed and a trailing `{ type: string; … }` member keeps it
forward-compatible.

`scripts/sync-contract.ts` (`sync-contract.ts:1`) copies
`src/station/contract.ts` (the single source of truth) into
`packages/glorp-client/src/contract.ts` with a generated header. Run plain to
write, or with `--check` to fail CI on drift. A test
(`tests/station-contract.test.ts`, referenced in the contract header) enforces
that these DTOs stay structurally identical to the canonical server types.

### Error model (`packages/glorp-client/src/errors.ts`)

Non-2xx responses throw `GlorpRemoteError` (`errors.ts:2`), carrying `.status`
(HTTP code) and `.code` (server `error` string); the message falls back to the
code. It mirrors Station's `StationRemoteError`.

## Starting the server (`src/cli-serve.ts`)

`runServe(args)` (`cli-serve.ts:13`) is the serve-mode entrypoint:

1. Resolves `dataDir` from `GLORP_DATA_DIR` (default `~/.glorp`) and creates it.
2. Resolves `port` from `args.port` or `GLORP_PORT`, and `token` from
   `args.token` or `GLORP_TOKEN`.
3. Calls `startServer({ workspace, dataDir, port, token, provider, model,
   permissionMode })`, logging the version, workspace, data dir, and listen
   address to **stderr**.
4. Installs `SIGINT`/`SIGTERM` handlers that call `server.stop()` (which removes
   the discovery file) and exit.

## Two servers, two protocols

It's easy to conflate the two HTTP/WS surfaces in this repo. They are distinct:

| | Local server (`src/server/`) | Station (targeted by `packages/glorp-client/`) |
|---|---|---|
| Default port | 3271 (`DEFAULT_PORT`) | 4271 (per `docs/openapi.yaml`) |
| Bind | `127.0.0.1` only | configurable; auth required off loopback |
| WS path | `/api/v1/sessions/:id/ws` | `/api/v1/sessions/:id/events` |
| WS auth | `?token=` query param | `?api_key=` query param |
| REST auth | `Bearer <token>` | `Bearer <apiKey>` (`glsk_…`) |
| WS frame | enveloped `ServerMessage` (`{type,seq,ts,…}`) | `EventEnvelope` `{sessionId,seq,event}` |
| Send message | sync `…/message` or WS `send_message` | `…/messages` (async 202, or `wait:true`) |
| In-repo client | `src/client/GlorpClient` | `@porkytheblack/glorp-client` |

`docs/openapi.yaml` documents the Station API and is the reference for the
standalone SDK's HTTP/WS contract.

## Key files

| File | Responsibility |
|---|---|
| `src/protocol/envelope.ts` | `Envelope`, `PROTOCOL_VERSION`, `DEFAULT_PORT`, `WS_CLOSE`, `ServerDiscovery`, `ErrorResponse` |
| `src/protocol/commands.ts` | `ClientMessage` union — client→server commands |
| `src/protocol/events.ts` | `ServerMessage` union — server→client events |
| `src/protocol/rest.ts` | REST request/response DTOs for the local server |
| `src/protocol/index.ts` | Public protocol surface (re-exports) |
| `src/server/server.ts` | `Bun.serve()` entry; routing, CORS, auth, WS upgrade |
| `src/server/router.ts` | REST handlers (`health`, sessions, profiles) |
| `src/server/session-pool.ts` | Single active `GlorpHandle` session lifecycle |
| `src/server/ws-handler.ts` | WS open/message/close, handshake, hello timer |
| `src/server/dispatch.ts` | `ClientMessage` → `GlorpHandle` method switch |
| `src/server/broadcast.ts` | Per-client fan-out of bridge events; peer events |
| `src/server/discovery.ts` | Write/read/remove `<dataDir>/server.json` |
| `src/server/message-endpoint.ts` | Synchronous send-and-collect REST endpoint |
| `src/server/index.ts` | Server module public surface |
| `src/client/client.ts` | In-repo REST+WS `GlorpClient` with reconnect |
| `src/client/rest.ts` | Typed `fetch` wrappers for the local REST API |
| `src/client/discovery.ts` | Locate a live local server (with liveness check) |
| `src/client/bridge-adapter.ts` | `ServerMessage` → `BridgeEvent` for the UI store |
| `src/client/index.ts` | In-repo client public surface |
| `src/cli-serve.ts` | `runServe` — serve-mode entrypoint + signal handling |
| `packages/glorp-client/src/index.ts` | SDK public API: `configure`, `run`, `streamSession` |
| `packages/glorp-client/src/config.ts` | SDK config resolution (opts → default → env) |
| `packages/glorp-client/src/run.ts` | `runWith` orchestration + `RunHandle` |
| `packages/glorp-client/src/client.ts` | `createClient` namespaced Station client |
| `packages/glorp-client/src/rest.ts` | SDK REST transport (`request`/form/binary/ping) |
| `packages/glorp-client/src/ws.ts` | SDK WS event stream (`/events`, async iterator) |
| `packages/glorp-client/src/contract.ts` | Generated, vendored Station wire contract |
| `packages/glorp-client/src/errors.ts` | `GlorpRemoteError` |
| `packages/glorp-client/scripts/sync-contract.ts` | Vendor/check the contract from `src/station/` |
| `docs/openapi.yaml` | OpenAPI spec for the Station API (SDK's contract) |
