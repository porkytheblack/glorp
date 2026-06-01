# @porkytheblack/glorp-client

A small, typed client for driving a remote [Glorp](https://github.com/porkytheblack/glorp)
Station: create workspaces, run coding agents, and poll or stream their results
over an API-key-secured HTTP/WS API. Zero runtime dependencies; runs in Node 18+,
Bun, and the browser.

```bash
npm add @porkytheblack/glorp-client
```

## Quick start

```ts
import { configure, run } from "@porkytheblack/glorp-client";

configure({ endpoint: "https://glorp.example.com", apiKey: "glsk_…" });

const handle = await run({
  workspace: "/srv/projects/acme",   // or { workspaceId: "ws_…" }
  prompt: "Add a /health endpoint and a test for it.",
});

const { text, status } = await handle.result();   // waits for the run to finish
console.log(status, text);
```

`configure()` is optional — the client auto-reads `GLORP_ENDPOINT` and
`GLORP_API_KEY` from the environment on first use.

## Run handle

`run()` creates a session, sends the first prompt, and returns a handle:

```ts
const h = await run({ workspaceId, prompt });

h.sessionId;                       // the new session id
await h.status();                  // SessionDto { state, busy, … }  — poll this
for await (const ev of h.events()) { … }   // live BridgeEvent stream (WebSocket)
await h.result({ timeoutMs });     // resolves with the latest agent answer
await h.abort();                   // stop the running turn
```

`run()` defaults `permissionMode` to `"auto"` so unattended runs don't deadlock
on a tool-permission prompt. Use `"bypass"` for zero prompts (disposable
workspaces only).

## Full client

```ts
import { createClient } from "@porkytheblack/glorp-client";

const glorp = createClient({ endpoint, apiKey });

await glorp.ping();
const ws = await glorp.workspaces.create("/srv/projects/acme");
const s  = await glorp.sessions.createInWorkspace(ws.id, { permissionMode: "auto" });
await glorp.sessions.sendMessage(s.id, "Refactor the auth module.");
const res = await glorp.sessions.result(s.id);

// or block until done in a single call:
const { text } = await glorp.sessions.sendMessageAndWait(s.id, "Now add tests.");

// admin:
const { key } = await glorp.keys.create("worker", ["run"]);
```

Namespaces: `workspaces`, `sessions`, `models`, `keys`, plus `run()` and
`streamSession()`.

## Errors

Non-2xx responses throw a typed `GlorpRemoteError` with `.status` and `.code`:

```ts
import { GlorpRemoteError } from "@porkytheblack/glorp-client";

try { await glorp.sessions.list(); }
catch (e) {
  if (e instanceof GlorpRemoteError && e.status === 401) { /* bad key */ }
}
```

## Config

```ts
configure({
  endpoint: "https://glorp.example.com",  // required
  apiKey: "glsk_…",                        // required unless the server is auth-off
  timeoutMs: 30_000,                       // optional per-request timeout
  fetch: customFetch,                      // optional (Node < 18, testing)
  WebSocketImpl: WebSocket,                // optional (e.g. Node's `ws`)
});
```

See [`docs/remote-orchestration.md`](../../docs/remote-orchestration.md) and
[`docs/openapi.yaml`](../../docs/openapi.yaml) for the full HTTP/WS contract.
