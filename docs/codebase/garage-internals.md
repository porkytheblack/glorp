# Glorp Garage — Runtime Internals

A code-level reference for the **multi-session server runtime** under `src/garage/`
and its CLI entrypoint `src/cli-garage.ts`. This complements the user-facing
[`garage-usage.md`](../garage-usage.md) and [`garage-spec.md`](../garage-spec.md)
— it documents how the code is structured, not how an operator invokes it.

> **Naming.** "Glorp Garage" here is the long-running `glorp garage` server
> (REST + WebSocket over many concurrent agents). It is distinct from the
> `garage-signal` fleet runner mentioned elsewhere in the README.

> **Scope.** The optional Dashboard SPA (`dashboard/`) is being deprecated and is
> *not* documented here. The only mention is the integration point in
> `src/garage/dashboard.ts` / `server.ts` where Garage can serve its pre-built
> static assets.

---

## 1. Overview

Garage is one `Bun.serve()` instance (`src/garage/server.ts:108`) that fronts a
REST API plus a per-session WebSocket endpoint. It hosts many independent
[`GarageSession`](../../src/garage/session.ts) objects, each wrapping its own
isolated `Bridge` and a lazily-built `GlorpHandle` from the agent layer
(`buildGlorp`). It is intentionally separate from the single-session
`src/server/` runtime (`src/garage/server.ts:1-8`).

Request flow:

```
Bun.serve.fetch (server.ts)
  ├─ OPTIONS                      → preflight() CORS
  ├─ origin check                 → rejectBrowserOrigin()
  ├─ strip /api/v1 prefix         → stripApiPrefix()
  ├─ WS upgrade /sessions/:id/events
  │     → requireAuth (if on) → manager.getOrRehydrate → srv.upgrade(makeWsData)
  ├─ dashboard GET (if enabled, non-API path) → serveDashboard()
  ├─ auth gate (requireAuth, /keys requires admin scope)
  └─ router.route(req, routePath)  (router.ts)
        → grouped handlers in routes/*.ts
```

Key cross-cutting behaviors set up in `server.ts`:

- **Dual path prefix.** Every REST route is reachable both bare (`/sessions`) and
  under the stable, versioned `/api/v1` prefix. `stripApiPrefix`
  (`server.ts:33`) removes a leading `/api/v1` so the route regexes match once.
- **CORS / origin policy.** `isAllowedBrowserOrigin` (`server.ts:54`) allows a
  request with no `Origin`, a same-origin request, or a loopback→loopback
  request; anything else gets a 403 `forbidden_origin`. `withCors`
  (`server.ts:44`) reflects allowed origins and always sets the base
  methods/headers.
- **Crash isolation.** `cli-garage.ts:27-32` installs `unhandledRejection` /
  `uncaughtException` handlers that log but keep the process alive — a rogue
  agent must not take down the whole runtime.
- **Graceful shutdown.** `SIGINT`/`SIGTERM` call `garage.stop()`
  (`cli-garage.ts:35-43`), which flushes and destroys every live session
  (`manager.shutdownAll`) and closes the key store before `server.stop()`.

`startGarage` returns a `GarageHandle` (`server.ts:81`) — `{ port, manager, stop }`.
When the caller passes `port: 0` (tests), the actually-bound port is reflected back
into `config.port` (`server.ts:177-180`) so generated `ws_url`s are correct.

---

## 2. CLI entrypoint and configuration

### `src/cli-garage.ts`

`runGarage(args)` is the `glorp garage` entrypoint (dispatched from
`src/cli.ts:47`). It:

1. Builds a `GarageConfig` via `loadGarageConfig` (`cli-garage.ts:11`), mapping
   CLI flags (`--port`, `--host`, `--data-dir`, `--workspace-root`, `--provider`,
   `--model`, `--permission-mode`, `--dashboard`) into config overrides.
2. Calls `startGarage(config)` (`cli-garage.ts:22`).
3. Installs the keep-alive error handlers and signal handlers, then blocks on a
   never-resolving promise to keep the event loop alive (`cli-garage.ts:46`).

The `glorp garage keys <add|list|revoke>` subcommands branch *before* the server
boots (`src/cli.ts:48`) into `runKeys` (`src/cli-keys.ts`), which talks to the
on-disk `KeyStore` directly — that is how the first key is minted without a running
server. `add` prints the raw key to STDOUT exactly once; all other output goes to
STDERR so the key can be piped.

### `src/garage/config.ts`

`loadGarageConfig(overrides)` (`config.ts:100`) layers, in increasing priority:

1. **Defaults** — hostname `127.0.0.1`, port `GARAGE_DEFAULT_PORT = 4271`
   (`config.ts:14`), `dataDir = ~/.glorp` (or `$GLORP_DATA_DIR`),
   `workspaceRoot = <dataDir>/workspaces`, `templatesDir = <dataDir>/templates`,
   `permissionMode = "normal"`, `dashboard = false`.
2. **`<dataDir>/garage.json`** — read by `readFileConfig` (`config.ts:90`);
   missing/corrupt file silently yields `{}`. Supplies hostname, port,
   workspaceRoot, templatesDir, defaultProvider/Model, permissionMode, dashboard,
   filesDir, auth.enabled.
3. **Environment** — `GLORP_DATA_DIR`, `GLORP_GARAGE_PORT`, and
   `GLORP_GARAGE_AUTH` (`envAuthEnabled`, `config.ts:83`).
4. **CLI overrides** — the `GarageConfigOverrides` passed in.

**Auth resolution.** `auth.enabled` is left `undefined` ("auto") unless something
sets it. At startup `authRequired(config)` (`config.ts:79`) resolves the effective
value: explicit `auth.enabled` wins; otherwise auth is **required for any
non-loopback bind** and **off on loopback** (`isLoopbackHost`, `config.ts:71`).
This preserves zero-config localhost dev while forcing auth the moment the server
is reachable from other hosts.

`src/garage/define-config.ts` exposes `defineConfig()`, a thin wrapper over
`loadGarageConfig` for embedding Garage in code — notably to inject a custom
`auth.keyStorage` adapter (e.g. SQLite) that cannot be expressed in JSON.

---

## 3. Routing (`src/garage/router.ts`)

`createGarageRouter` (`router.ts:38`) instantiates each route group once and
returns a single `route(req, pathname)` dispatcher. Matching is hand-rolled
regex + method checks against the pre-stripped path:

- `GET /health` (`router.ts:60`) — the only route exempt from auth in `server.ts`.
- `/keys` CRUD (`router.ts:62-65`) — admin-scope gated upstream.
- `/models/...` — catalog, providers, profiles, activate (`router.ts:67-77`).
- `/templates`, `/templates/:name` (`router.ts:79-81`).
- `/workspaces…` → `matchWorkspaceRoute` (`route-workspaces.ts`): list/create,
  `/workspaces/:id`, `/workspaces/:id/sessions`, and the MCP provisioning sub-routes
  `/workspaces/:id/mcp` (GET list · POST install), `…/mcp/sync`,
  `…/mcp/:provider/sync`, and `…/mcp/:provider` (DELETE).
- `/sessions`, `/sessions/:id` (`router.ts:102-117`).
- `/sessions/:id/<resource>[/<rest>]` → `routeSubpath` (`router.ts:133`), a
  `switch` over the sub-resource: `messages`, `abort`, `permission-mode`,
  `profile`, `history`, `result`, `plan`, `tasks`, `agents`, `slots`,
  `permissions`, `credentials`, `files`.

Unmatched paths → 404 `not_found`; matched path with wrong method →
`methodNotAllowed()` 405. Any thrown error inside a handler is caught in
`server.ts:158` and returned as 500 `internal`.

Response helpers live in `src/garage/respond.ts`: `json`, `errorJson`
(`{ error, message }` envelope), `noContent` (204), and `readJson` (empty body →
`{}`).

---

## 4. Route handlers (`src/garage/routes/`)

### sessions.ts — lifecycle + messaging
- `POST /sessions` → `create` (`sessions.ts:55`) parses a `CreateSessionInput` and
  delegates to `createSessionResponse` (`sessions.ts:33`), which maps known
  failures to status codes: `SessionExistsError` → 409, `WorkspaceError` → 400,
  else 500. On success returns the DTO + `ws_url` with 201.
- `GET /sessions` → `list` returns `{ sessions, total }`.
- `GET /sessions/:id` → rehydrates if needed; 404 if unknown.
- `DELETE /sessions/:id` → `destroy`; `?workspace=true` also removes the workspace
  directory (subject to the safety checks in §6).
- `POST /sessions/:id/messages` → `sendMessage` (`sessions.ts:83`). Default is
  **fire-and-forget** (202 `accepted`, client watches the WS). With `{ wait: true }`
  it runs synchronously via `handleSendMessage` (shared with `src/server/`) and
  returns the full turn; a result with an error and no text becomes 502.
- `sessionWsUrl` (`sessions.ts:24`) builds the `/api/v1/...events` URL on the
  configured host/port.

### workspaces.ts — first-class workspaces
Register folders and manage their sessions: `list`, `create` (mints a managed folder
under `workspaceRoot` when no `path` is given),
`get` (includes the session list), `destroy` (`?sessions=true` cascades a destroy
of member sessions), `listSessions`, and `createSession` (delegates to
`createSessionResponse` with `workspaceId` injected). 404s are uniform via
`notFound` (`workspaces.ts:82`).

### mcp.ts — MCP provisioning (code-as-tools)
Workspace-scoped install/list/sync/remove of external MCP providers, delegating to the
`src/mcpgen` engine against the workspace's folder: `add` (introspect → generate; 201 +
diff), `list` (providers from the manifest, tokens redacted), `syncAll` / `syncOne`
(re-introspect + diff), `remove` (204). The tool lister is injectable so tests provision
without the network. Dispatch lives in `route-workspaces.ts`.

### state.ts — read-only queries
All use `manager.getOrRehydrate` and read through `session.peekStore()` (no model
build, see §5): `history` (turns via `turnsFromMessages`), `result` (latest agent
text + status, the one-call orchestration fetch, `state.ts:34`), `plan`, `tasks`,
`permissions`, and `revokePermission` (`DELETE .../permissions/:key`, key is
URL-decoded). `agents` (`state.ts:88`) *does* build the handle to read the roster
and returns 502 on build failure.

### control.ts — live-session control
Operates on the *live* handle (`session.current()`); returns 409 `not_active` when
the session isn't in memory. `abort` is a no-op for non-live sessions
(`control.ts:30`). `resolveSlot` (`control.ts:38`) supports actions
`approve`/`deny`/`resolve`/`reject` (with `allow` as a legacy shorthand).
`setPermissionMode` validates against `["normal","auto","bypass"]`. `setProfile`
swaps the model profile. Multi-agent roster ops (`addAgent`, `switchAgent`,
`removeAgent`) use `getOrRehydrate` + `ensureBuilt` via `runRoster`
(`control.ts:143`), mapping failures to 502 `agent_failed`.

### credentials.ts — per-session custom keys
`POST /sessions/:id/credentials` requires `provider` + `apiKey`, calls
`session.setCredential`, returns the DTO (the response shows only provider +
last-4). `DELETE` clears it (`clear`). Keys are held in memory only — never
persisted, never returned (see §7).

### files.ts — workspace file exchange
Each session gets a dedicated subfolder under its workspace (`config.filesDir`,
default `uploads`, `files.ts:17`), created on first use by `rootFor`. Supports
`list` (recursive `walk`), `upload` (multipart, 201), `download` (streams via
`Bun.file` with a `content-disposition` attachment header), and `remove`. All
relative paths go through `resolveSafePath` (from `agent/tools/fs-shared.ts`) to
confine access to the folder and block traversal. The agent reads/writes the same
folder, so uploads become inputs and deliverables become downloadable.

### models.ts — provider/profile management
Wraps the Garage-wide `CredentialsStore`: `providers`, `profiles` (with
`active_profile_id`), `activate`, `catalog` (known providers + selectable models,
`models.ts:63`), `addProvider`/`deleteProvider`, `addProfile`/`deleteProfile`. API
keys are accepted on write but never returned — reads expose only `has_api_key`.

### templates.ts — template browse (read-only)
`list` (name/description/step_count) and `get` (full template) over the
`TemplateStore`. There is no provisioning endpoint; templates are applied only at
session creation.

### keys.ts — API-key management (admin scope)
`create` (returns the raw key once inside a `{ data }` envelope, 201), `list`
(public records, no hashes), `revoke`. Admin-scope enforcement happens upstream in
`server.ts:150-153`; the handlers assume the caller is already authorized.

### health.ts — `GET /health`
Returns `{ status, version (GLORP_VERSION), uptime_ms, live_sessions }`. Exempt
from auth.

---

## 5. Session lifecycle (`src/garage/session.ts`)

A `GarageSession` owns: a `Bridge` (isolated event bus), an `EventStream`
(WS fan-out), `SessionStats`, a `SessionLifecycle` state, and a lazily-built
`GlorpHandle`.

**Lifecycle states** (`types.ts:14`): `provisioning` → `idle` → `busy` →
(`error` | `destroyed`). `provisioning` covers template setup; `idle`/`busy` come
from the agent's `busy` BridgeEvent folded in `onEvent` (`session.ts:189`);
`error` is set by `fail()` on an unrecoverable agent failure (without killing
Garage); `destroyed` is terminal.

**Lazy build.** The `GlorpHandle` is built on demand by `ensureBuilt`
(`session.ts:54`), which dedupes concurrent callers via a cached `buildPromise`
and *drops the cache on failure* so a later attempt (e.g. after a working key is
supplied) can retry. `build()` (`session.ts:79`) constructs `BuildGlorpOptions`
and calls `buildGlorp`. Crucially, when a custom credential or explicit `profileId`
is set it does **not** pass `provider`/`model` — those would force `pickModel`'s
CLI branch and ignore the overlaid key (`session.ts:92-95`).

**Read without building.** `peekStore()` (`session.ts:159`) returns the live
handle's store if built, else a standalone read-only `GlorpStore` — this lets the
`state.ts` routes answer without spinning up a model adapter.

**Other operations:** `send` (builds then sends, captures fatal errors via
`fail`), `setCredential`/`clearCredential` (swap the live profile, §7), `hydrate`
(replay full state to WS clients), `destroy` (shutdown handle, mark destroyed),
`flush` (persist the store on shutdown), `toDto` (delegates to
`buildSessionDto`).

**DTO** (`session-dto.ts`): a secret-free view (`SessionDto`, `types.ts:86`).
`custom_credentials` exposes only `{ provider, last4 }`. Stats are read from the
synchronously-maintained `SessionStats` (`session-stats.ts`), which folds
`busy`/`title`/`stats`/`session_hydrate` events so `toDto()` need not await the
store.

---

## 6. Manager, workspaces, persistence, templates

### SessionManager (`src/garage/manager.ts`)
The in-memory registry (`Map<id, GarageSession>`) bridged to on-disk snapshots.

- `create` (`manager.ts:45`) — rejects duplicate ids (in-memory *or* on-disk
  snapshot), resolves the workspace path, validates/creates it, optionally runs a
  template, associates a first-class workspace, and registers the session.
- `provisionTemplate` (`manager.ts:62`) — runs the template; on failure tears down
  **only** a workspace dir Garage itself created (never a pre-existing
  caller-supplied dir).
- `getOrRehydrate` (`manager.ts:118`) — returns the live session, else rebuilds a
  dormant one from its on-disk snapshot metadata (the handle stays unbuilt until
  `ensureBuilt`).
- `list` (`manager.ts:129`) — merges live sessions with dormant on-disk ones
  (`dormantDto`, `manager.ts:270`), sorted by last activity.
- `destroy` (`manager.ts:188`) — unloads the session, deletes its snapshot (so it
  can't resurrect), and optionally removes the workspace dir.
- `maybeRemoveWorkspaceDir` (`manager.ts:210`) — workspace deletion is only allowed
  when the dir lives **under `workspaceRoot`** (a Garage-provisioned sandbox) AND
  **no other session references it**; otherwise the folder is kept and a warning is
  logged. This guards against wiping shared or user-owned folders.
- `shutdownAll` flushes + destroys every session on graceful stop.

### WorkspaceStore (`src/garage/workspace-store.ts`)
Persists first-class workspaces at `<dataDir>/workspaces.json` (atomic tmp+rename,
mode `0o600`). A workspace id is **deterministic from its resolved absolute path**
(`workspaceIdForPath`, `workspace-store.ts:17`: `ws_` + first 12 hex of sha256), so
the same folder always maps to the same id even if the registry file is lost.
`ensureForPath` (`workspace-store.ts:85`) is the get-or-create migration primitive
that lazily folds bare session paths into real workspace entities.

### Persistence (`src/garage/persistence.ts`)
Reuses the agent's `GlorpStore` snapshot files (`resolveSessionPaths`).
`snapshotExists` and `readSnapshotMeta` (`persistence.ts:29`) read just the
metadata Garage needs to rehydrate (workspace path, title, token/turn counts, and
mtime as `lastActivity`).

### Templates (`src/garage/templates/`)
- **types.ts** — a `Template` is an ordered list of `TemplateStep`s
  (`git-clone` | `shell` | `copy`). Values support `{param:NAME}` (from the
  create-session request) and `{env:VAR}` (process env) interpolation.
- **store.ts** — `TemplateStore` reads `<templatesDir>/*.json`; each file is a
  template named after its filename unless it declares its own `name`.
- **engine.ts** — `provision` (`engine.ts:31`) runs steps sequentially, throwing
  `TemplateError` on the first failure. `interpolate` (`engine.ts:14`) resolves
  tokens and records substituted values as *secrets*; `redact` (`engine.ts:93`)
  scrubs those values from any error text so a secret never leaves the host. `copy`
  steps are confined to the workspace via `isWithin` (`engine.ts:102`); `git-clone`
  and `shell` run through `Bun.spawn`.

The manager receives templates as a `TemplateProvisioner` adapter (`server.ts:97`),
decoupling it from the concrete `TemplateStore`.

---

## 7. Credentials and per-session keys

There are two distinct credential surfaces:

1. **Garage-wide** — the shared `CredentialsStore` (`agent/credentials.ts`)
   constructed in `server.ts:88` and exposed read/write through the
   `models.ts` routes. This is the on-disk provider/profile config.

2. **Per-session overlay** — `SessionCredentialsStore`
   (`src/garage/credentials.ts`) subclasses `CredentialsStore` and adds an
   **in-memory overlay** for a session's custom API key. The overlay is **never
   flushed to disk**. `setCustom` (`credentials.ts:32`) builds an overlay provider
   + a synthetic profile id (`session__<provider>__<model>`); overridden
   `getProvider`/`getProfile`/`getActiveProfile`/`listProfiles`/`listProviders`
   prefer the overlay. `setActive` is overridden to be **in-memory only**
   (`credentials.ts:80`) so one session can never rewrite the shared config.
   `garageDefaultProfileId` reads the underlying store's active profile, used when
   clearing the overlay reverts to Garage defaults.

When a session's credential is set/cleared at runtime (`session.setCredential` /
`clearCredential`, `session.ts:104-120`), the live handle is hot-swapped via
`handle.swapProfile`. Clearing without a Garage default profile is rejected.

The `SessionCredential` type (`types.ts:33`) is `{ provider, apiKey, model? }`.
It is never logged or returned; the DTO surfaces only provider + last-4
(`session-dto.ts:25`).

---

## 8. Auth layer (`src/garage/auth/`)

**Enforcement point.** `server.ts` decides per-request whether to require auth via
`authRequired` (loopback-aware, §2). When on, every REST route except `/health`
calls `requireAuth` (`server.ts:147`), and `/keys*` additionally calls
`requireScope(key, "admin")` (`server.ts:150`). WebSocket upgrades are also gated
(`server.ts:125`).

**middleware.ts** — `extractKey` (`middleware.ts:13`) reads the key from
`Authorization: Bearer <key>` or, for WS upgrades that can't set headers, an
`?api_key=` query param. `requireAuth` (`middleware.ts:23`) verifies it against the
`KeyStore` and returns `{ ok, key }` or a 401 response. `requireScope`
(`middleware.ts:32`) returns 403 unless the key has the scope — and `admin` implies
all scopes.

**key-store.ts** — `KeyStore` owns all crypto and delegates persistence to an
`ApiKeyStorageAdapter`. Raw keys are `glsk_<24 random bytes base64url>`
(`KEY_PREFIX`, `key-store.ts:13`); only the **sha256 hash** and a 12-char
`keyPrefix` are stored (`create`, `key-store.ts:27`). `verify` (`key-store.ts:45`)
hashes the presented key, rejects revoked/expired records, and touches `lastUsed`.
Default scopes are `["admin"]`.

**Storage adapters** (`auth/types.ts` `ApiKeyStorageAdapter`):
- `FileKeyStorage` (default) — JSON file at `<dataDir>/glorp-keys.json`. Durable
  writes via fsync'd tmp + rename + best-effort dir fsync; file `0o600`, dir
  `0o700`. Single-process only (`file-key-storage.ts`).
- `MemoryKeyStorage` — non-persistent, for tests/ephemeral runs.
- `SqliteKeyStorage` — optional `better-sqlite3` backend, loaded lazily via
  `createRequire` so it's never a hard dependency. Wired in only by passing
  `auth.keyStorage` through `defineConfig`.

The public surface is re-exported from `src/garage/auth/index.ts`.

---

## 9. WebSocket and event streaming

**ws.ts** — one WS connection subscribes to exactly one session
(`/sessions/:id/events`). `handleWsOpen` (`ws.ts:28`) registers a `StreamClient`,
adds it to the session's `EventStream`, then calls `session.hydrate()` to build the
handle (if needed) and replay full state. `handleWsClose` removes the client.
`handleWsMessage` parses a small command set and dispatches (`ws.ts:61`):
`send_message` and `resync` act on the session; the rest (`abort`,
`resolve_permission`, `resolve_slot`, `reject_slot`, `set_permission_mode`,
`swap_profile`, `switch_agent`, `add_agent`, `remove_agent`) act on the live
handle, building it on demand to avoid a connect-then-command race.

**event-stream.ts** — `EventStream` fans Bridge events out to all clients of a
session. Each `StreamClient` carries its own monotonic `seq`; events are wrapped in
the `{ sessionId, seq, event }` envelope (`EventEnvelope`, `types.ts:22`) so clients
can detect drops and request a re-hydrate. Sends are skipped for non-OPEN sockets
and swallow errors (the close handler reaps broken sockets).

The session pipes its own bus into the stream in `onEvent` (`session.ts:189`),
which also updates `lastActivity`, folds stats, and flips lifecycle state on
`busy` events.

---

## 10. Dashboard integration point (not documented further)

When `config.dashboard` is true, any non-API `GET` is served by `serveDashboard`
(`server.ts:139`, `src/garage/dashboard.ts`) as static files with SPA fallback.
`dashboardSearchPaths` probes several on-disk locations (env override, `<dataDir>/
dashboard`, `dist/dashboard`, next to the executable) to work across source, npm,
and compiled-binary installs. With the dashboard **off**, `GET /` returns a small
JSON status object (`server.ts:142`). The dashboard's own code is out of scope.

---

## 11. Key files

| Path | Responsibility |
|------|----------------|
| `src/cli-garage.ts` | `glorp garage` entrypoint: builds config, boots `startGarage`, keep-alive + signal handling. |
| `src/cli-keys.ts` | `glorp garage keys add\|list\|revoke` — offline key minting against the on-disk `KeyStore`. |
| `src/garage/server.ts` | `Bun.serve()` host: CORS/origin, `/api/v1` stripping, auth gate, WS upgrade, dashboard, `startGarage`/`GarageHandle`. |
| `src/garage/router.ts` | REST dispatch — regex/method matching delegating to `routes/*`. |
| `src/garage/config.ts` | Config resolution (defaults + `garage.json` + env + overrides) and loopback-aware `authRequired`. |
| `src/garage/define-config.ts` | `defineConfig()` for embedding Garage and injecting a custom key-storage adapter. |
| `src/garage/manager.ts` | `SessionManager`: live registry, create/destroy, rehydration, workspace association + safe cleanup. |
| `src/garage/session.ts` | `GarageSession`: lifecycle, lazy `GlorpHandle` build, credential swaps, event bridging. |
| `src/garage/session-init.ts` | `GarageSessionInit` shape passed into a session. |
| `src/garage/session-dto.ts` | Secret-free `SessionDto` builder. |
| `src/garage/session-stats.ts` | Synchronous stats snapshot folded from Bridge events. |
| `src/garage/credentials.ts` | `SessionCredentialsStore`: in-memory per-session key overlay (never persisted). |
| `src/garage/persistence.ts` | On-disk snapshot existence/metadata for rehydration. |
| `src/garage/workspace-store.ts` | Persisted first-class workspace registry; deterministic path→id. |
| `src/garage/ws.ts` | WebSocket lifecycle + client command dispatch. |
| `src/garage/event-stream.ts` | Per-session fan-out with per-client `seq` and `{sessionId,seq,event}` envelope. |
| `src/garage/respond.ts` | `json` / `errorJson` / `noContent` / `readJson` helpers. |
| `src/garage/types.ts` | Core types: lifecycle, DTOs, inputs, `SessionCredential`, `Workspace`, envelope. |
| `src/garage/dashboard.ts` | Static-asset serving for the (deprecated) dashboard SPA — integration point only. |
| `src/garage/routes/sessions.ts` | Session create/list/get/destroy + `messages` (sync `wait` and async). |
| `src/garage/routes/workspaces.ts` | First-class workspace CRUD + member-session create/list. |
| `src/garage/routes/state.ts` | Read-only queries: history, result, plan, tasks, permissions, agents. |
| `src/garage/routes/control.ts` | Live-session control: abort, slots, permission-mode, profile, roster. |
| `src/garage/routes/credentials.ts` | Per-session custom-key set/clear. |
| `src/garage/routes/files.ts` | Session workspace file exchange (list/upload/download/remove). |
| `src/garage/routes/models.ts` | Garage-wide provider/profile management + catalog. |
| `src/garage/routes/templates.ts` | Read-only template browse. |
| `src/garage/routes/keys.ts` | API-key CRUD (admin scope). |
| `src/garage/routes/health.ts` | `GET /health`. |
| `src/garage/templates/types.ts` | Template/step shapes and `TemplateError`. |
| `src/garage/templates/store.ts` | Loads templates from `<templatesDir>/*.json`. |
| `src/garage/templates/engine.ts` | Sequential step execution with secret redaction and workspace confinement. |
| `src/garage/auth/middleware.ts` | Key extraction, `requireAuth`, `requireScope`. |
| `src/garage/auth/key-store.ts` | `KeyStore`: key generation, hashing, verification. |
| `src/garage/auth/types.ts` | `ApiKey`, `ApiKeyPublic`, `ApiKeyStorageAdapter`, `toPublic`. |
| `src/garage/auth/file-key-storage.ts` | Default durable JSON-file key adapter. |
| `src/garage/auth/memory-key-storage.ts` | In-memory key adapter (tests). |
| `src/garage/auth/sqlite-key-storage.ts` | Optional `better-sqlite3` key adapter (lazy-loaded). |
| `src/garage/auth/index.ts` | Public re-exports of the auth layer. |
