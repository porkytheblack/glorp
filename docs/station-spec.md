# Glorp Station — Product Specification

## Problem Statement

Today, running Glorp on a remote server means SSH-ing in, launching a single TUI session, and staying connected for the duration. There is no way to run multiple Glorp agents simultaneously, disconnect and reconnect to a running session, or programmatically create and manage sessions from an IDE extension or CI pipeline. Developers who want to run Glorp on a powerful remote machine, or orchestrate multiple agents in parallel, have no supported path.

## Target Users

**Primary: Solo developer with a remote dev server.** Has a VPS or workstation they SSH into. Wants to fire up Glorp sessions for different projects, leave them running, and connect from their laptop, phone, or a CLI client. Comfortable with the command line.

**Secondary: Team lead or platform engineer.** Wants to offer Glorp-as-a-service to a small team (2-10 developers). Each developer gets their own sessions, the team shares a pool of API keys. No billing, no usage tracking — just a shared server running agents.

**Explicitly not (in v1): Enterprise multi-tenancy.** RBAC, per-user billing, audit logging, SSO — none of this ships in v1. Station is a power tool for people who trust their server, not a SaaS platform.

## Value Proposition

- **User value:** Run Glorp sessions that persist across connections. Start a task from your desk, check progress from your phone, pick it back up tomorrow. Run five agents in parallel against five repos without five terminal windows.
- **Business value:** Unlocks "remote Glorp" — a prerequisite for any future client, VS Code extension, or collaborative feature. Also makes Glorp viable for CI/automation workflows (create session, send prompt, poll for completion, tear down).

## What Glorp Station Is

Glorp Station is a long-running Bun process that:

1. **Hosts a REST + WebSocket API** for managing Glorp sessions.
2. **Manages the lifecycle** of multiple concurrent `GlorpHandle` instances, each scoped to its own workspace directory and event bus.
3. **Provisions workspaces** from declarative setup templates (clone a repo, run init scripts).
4. **Manages model credentials** with a layered model: Station provides defaults, sessions can override with custom API keys passed at creation time or changed at runtime.
5. **Streams session events** over WebSocket so any client (TUI, CLI, IDE extension) renders the same experience the terminal TUI does today.

Station is **not** a scheduler, a queue, or a CI system. It does not decide when to run agents. It does not watch git for changes. It is a runtime that holds sessions in memory and exposes them over a network API.

## User Stories

### P0 — Must ship

1. As a developer, I want to **create a new session** by pointing Station at a directory on the host, so I can start an agent without SSH-ing into a TUI.
2. As a developer, I want to **send a message to a running session** and **receive the full event stream** (text deltas, tool calls, plan updates, task progress) over WebSocket, so my client renders the same experience as the terminal TUI.
3. As a developer, I want to **list all sessions** and see their status (idle/busy, workspace, last activity, token counts).
4. As a developer, I want to **resume a session** created in a previous connection, so I can disconnect and reconnect without losing state.
5. As a developer, I want to **respond to permission prompts** through the API, so when the agent asks "Can I run `rm -rf`?", I can approve or deny remotely.
6. As a developer, I want to **abort a running request**, so I can stop a runaway agent.
7. As an admin, I want to **configure default API keys** on the Station that all sessions inherit.
8. As a developer, I want to **provide my own API key** when creating a session, so I can use my personal quota or a different provider without touching Station config.

### P1 — Should ship in v1, can be descoped

9. As a developer, I want to **create a session from a setup template** that clones a git repo and runs initialization scripts.
10. As a developer, I want to **destroy a session** and optionally clean up its workspace directory.
11. As a developer, I want to **query session state** (conversation history, plan, tasks, stats) via REST without needing a WebSocket connection.
12. As a developer, I want to **change my API key on a running session**, so I can switch providers mid-task without creating a new session.

### P2 — Fast follow

13. As an admin, I want to **assign model profiles to sessions** (e.g., "this session uses Claude Sonnet, that one uses GPT-5").
14. As a developer, I want to **swap the model** on a live session through the API.
15. As a developer, I want to **set the permission mode** for a session (normal/auto/bypass) at creation time, so CI-driven sessions can run without human-in-the-loop.

## Key User Flows

### Flow 1: Create session and start working

1. Client sends `POST /sessions` with `{ workspace: "/home/dev/my-app" }` (uses Station's default API key) or `{ workspace: "/home/dev/my-app", credentials: { provider: "anthropic", apiKey: "sk-..." } }` (uses custom key).
2. Station creates a `GlorpHandle` with the resolved credentials, returns a session object with id and status.
3. Client opens a WebSocket to `/sessions/{id}/events`.
4. Client sends `POST /sessions/{id}/messages` with `{ text: "Add rate limiting to the API routes" }`.
5. Station calls `glorpHandle.send(text)`.
6. Client receives a stream of `BridgeEvent`s over WebSocket: text_delta, tool_started/finished, display_slot_pushed (permission prompts).
7. If a permission prompt arrives, client sends `POST /sessions/{id}/slots/{slotId}` with `{ action: "approve" }`.
8. Station calls `glorpHandle.resolvePermission(slotId, true)`. Agent continues.
9. Eventually a `busy: false` event arrives. Agent is idle.

### Flow 2: Reconnect to existing session

1. Client sends `GET /sessions` to list all sessions with metadata.
2. Client opens WebSocket to `/sessions/{id}/events`.
3. Station sends `session_hydrate` event with full state (conversation history, plan, tasks, inbox, stats).
4. Client renders current state. Can send new messages normally.

### Flow 3: Create session from template

1. Client sends `POST /sessions` with `{ template: "next-app", params: { repo: "github.com/me/my-repo" } }`.
2. Station runs template steps sequentially: mkdir workspace, git clone, bun install, copy config files.
3. Station creates `GlorpHandle` for the new workspace.
4. Returns session object with workspace path.

## Scope Boundaries

### In scope

- Multi-session lifecycle management (create, list, destroy, query state)
- REST API for session management and message sending
- WebSocket API for real-time event streaming (1:1 mapping to existing `BridgeEvent` types)
- Layered credentials: Station defaults + per-session custom API keys
- Setup templates (declarative workspace provisioning)
- Session persistence — sessions survive Station restarts by re-hydrating from GlorpStore snapshots
- Basic health/status endpoint

### Out of scope — explicitly excluded from v1

- **Authentication and authorization.** Station binds to localhost or a private network. If you need auth, put it behind a reverse proxy. We are not building a user system.
- **User accounts and multi-tenancy.** One Station instance = one admin. Everyone with API access is equal.
- **Rate limiting or usage quotas.** Model providers handle this.
- **Container/VM isolation.** Sessions run as the Station process user. Workspaces are directories. The permission system is the safety layer.
- **Automatic session scheduling.** No cron, no git-hook triggers. Station is a runtime, not a scheduler.
- **Remote workspace sync.** Workspaces must exist on Station's filesystem.
- **Session migration between Station instances.**

### Future considerations (post-v1)

- Bearer token auth (simple shared-secret, not a user system)
- Session tagging and filtering
- Webhook notifications (on session idle, on error, on permission prompt)
- Workspace cleanup policies (auto-destroy after N days of inactivity)
- Resource limits (max concurrent sessions, max workspace disk usage)
- Session log export

## Success Metrics

1. **Can create a session, send a message, and receive the event stream over the network** without touching a terminal on the host. This is the "does it work" bar.
2. **Session state survives Station restarts.** Kill the process, start it again, sessions rehydrate from disk, clients reconnect and see full history.
3. **Five concurrent sessions without cross-contamination.** Events from session A never leak to session B. Workspaces, credentials, and permissions are isolated.
4. **Latency under 50ms** between agent event emission and WebSocket delivery on a local network. Streaming should feel like the TUI.
5. **Template-created session startup time dominated by template steps** (git clone, npm install), not Station overhead. Station's own setup should complete in under 1 second.

## Technical Considerations

### Critical refactor: Bridge isolation

Today `getBridge()` at `src/shared/bridge.ts` returns a process-global singleton. Station must give each session its own Bridge instance. The fix: pass a Bridge into `buildGlorp()` via `BuildGlorpOptions` instead of importing the global. This already has precedent — `credentials` is optional on `BuildGlorpOptions`. This is the single most important change before anything else works.

### Session lifecycle states

A session needs clear states: `provisioning` (template running), `idle` (agent not processing), `busy` (agent processing a request), `error` (unrecoverable failure), `destroyed`. The existing `busy` BridgeEvent covers idle/busy transitions. Station adds the outer lifecycle envelope.

### Process model

All sessions run in the same Bun process. Glorp is IO-bound (waiting on LLM API calls), not CPU-bound, so this is fine for 5-20 concurrent sessions. If a session's agent throws an unhandled rejection, Station must catch it and move the session to `error` state without crashing the entire process. The existing 30-minute watchdog in `glorp.ts` `send()` is a starting point but needs hardening.

### Workspace provisioning

Templates are JSON files stored in `<stationDataDir>/templates/`. Each template is an ordered list of steps: `{ type: "git-clone", repo: "..." }`, `{ type: "shell", command: "bun install" }`, `{ type: "copy", from: "...", to: "..." }`. Steps run sequentially. If any step fails, session creation fails and the workspace is cleaned up. Template parameters use `{param:NAME}` interpolation.

### Credentials: layered model with custom API keys

Credentials resolve in priority order:

1. **Session-level override** — custom API key passed in `POST /sessions` or `POST /sessions/:id/credentials`. Held in memory only for the life of the session and never persisted to disk (per Open Question 7, recommendation b). Never logged, never returned in API responses (only `provider` + last-4 of key shown). Sessions that need persistence re-supply the key on reconnect.
2. **Station default** — the CredentialsStore configured on the Station. Sessions that don't provide a custom key inherit this.
3. **Workspace glorp.json** — existing `loadProjectConfig` can reference a provider/model, but keys always come from layer 1 or 2.

The session-level credential is a thin wrapper: Station constructs a `CredentialsStore` per session that merges the custom key (if any) on top of the Station-wide store. This store is passed to `BuildGlorpOptions.credentials`. When a session's key is revoked or changed, Station rebuilds the model adapter via `glorpHandle.swapProfile()`.

API surface:
```
POST   /sessions/:id/credentials          Set custom API key for a session
DELETE /sessions/:id/credentials          Revert to Station defaults
```

The `POST /sessions` body accepts an optional `credentials` object:
```json
{
  "workspace": "/home/dev/my-app",
  "credentials": {
    "provider": "anthropic",
    "apiKey": "sk-ant-...",
    "model": "claude-sonnet-4-20250514"
  }
}
```

### REST API surface

```
POST   /sessions                          Create session (accepts optional credentials)
GET    /sessions                          List sessions
GET    /sessions/:id                      Get session detail
DELETE /sessions/:id                      Destroy session
POST   /sessions/:id/messages             Send message to agent
POST   /sessions/:id/abort               Abort current request
GET    /sessions/:id/history              Conversation history
GET    /sessions/:id/plan                 Current plan
GET    /sessions/:id/tasks                Task list
POST   /sessions/:id/slots/:sid           Resolve display slot / permission
GET    /sessions/:id/permissions          List granted permissions
DELETE /sessions/:id/permissions/:key     Revoke a permission
POST   /sessions/:id/credentials          Set custom API key for session
DELETE /sessions/:id/credentials          Revert session to Station defaults

GET    /templates                         List templates
GET    /templates/:name                   Template detail

GET    /models/providers                  Configured providers
GET    /models/profiles                   Configured model profiles
POST   /models/profiles/:id/activate     Set default profile

GET    /health                            Station health check
```

### WebSocket protocol

Endpoint: `GET /sessions/:id/events` (upgrade to WS). On connect, sends `session_hydrate`. Then streams `BridgeEvent`s wrapped in an envelope: `{ sessionId, seq, event }`. The `seq` enables missed-event detection. Multiple clients can subscribe to the same session simultaneously.

### Entry point

Station is a separate entry point (`src/station/`) that reuses the agent layer (`src/agent/`) but has its own HTTP/WS server. Do not retrofit the existing `src/server/` — compose from agent primitives cleanly.

## Open Questions

1. **Default workspace location.** Proposal: `<stationDataDir>/workspaces/<session-id>/`. User-specified paths accepted as-is. Station validates the path is writable at creation time. Fail fast.

2. **Auto-pause on inactivity.** If a session has been idle for 2+ hours, should Station release its in-memory GlorpHandle and re-hydrate on next request? Skip for v1; add if memory pressure is observed.

3. **Template secrets.** Template params should support `{env:VAR}` interpolation. Station injects env vars into step execution but never logs or persists interpolated values.

4. **WebSocket envelope vs raw events.** Wrap in `{ sessionId, seq, event }`. The seq enables clients to detect gaps and request re-hydrate. The sessionId future-proofs for multiplexed connections.

5. **Default model profile for new sessions.** Use CredentialsStore's active profile as default, accept `profileId` in create-session request as override, and honor `glorp.json` in workspace via existing `loadProjectConfig`.

6. **Station configuration file.** `station.json` in the data dir, with CLI flag overrides for address and port.

7. **Custom API key storage.** Session-level API keys must not be stored in plaintext. Options: (a) encrypt at rest with a Station master key derived from a passphrase, (b) hold only in memory and require re-submission on Station restart, (c) use OS keychain. Recommendation: (b) for v1 — simplest, no crypto dependency, keys are transient. Sessions that need persistence can re-supply keys on reconnect.

## Implementation Phases

### Phase 1 — The skeleton (1-2 weeks)

- Refactor Bridge to be injectable (not global singleton)
- Build session manager (create, list, destroy with `buildGlorp()`)
- HTTP server with session CRUD endpoints
- WebSocket event streaming for a single session
- Basic health endpoint

### Phase 2 — Fully functional (1-2 weeks)

- Permission prompt resolution via API
- Abort support
- Session state query endpoints (history, plan, tasks)
- Multi-client WebSocket (multiple subscribers per session)
- Session rehydration on Station restart
- Centralized model management endpoints

### Phase 3 — Templates and custom credentials (1 week)

- Setup template engine
- Template CRUD endpoints
- Per-session custom API key endpoints
- Error recovery (session error state, process-level exception handling)
- Station configuration file
- Graceful shutdown (flush all sessions on SIGTERM)
