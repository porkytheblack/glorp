# mcpgen — MCP-workspace provisioning engine

Turns an **MCP server URL + identity tokens** into a self-contained, self-authenticating
**workspace of code-as-tools** that a glorp coding-agent session can execute. This is the
"[code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)"
pattern: deterministic codegen of one typed wrapper file per MCP tool, so the agent reads
only the tools it needs and intermediate results stay in the execution environment.

The provisioning system calls the engine **once per workspace** (and again to update);
thereafter the backend only sends prompts.

## What gets generated

```
<workspace>/
  .claude/skills/mcp/SKILL.md   # teaches the agent the convention (auto-loaded by glorp)
  mcp/
    manifest.json               # source of truth: providers, urls, tools, hashes, versions
    identities.json             # public identity names + labels + default (NO tokens)
    index.md                    # tool catalogue (progressive disclosure)
    _runtime/client.ts          # dependency-free MCP client; reads the token at call time
    <provider>/<tool>.ts        # one typed wrapper per MCP tool
    <provider>/index.ts         # barrel
  .secrets/keys.json            # tokens, 0600 — the ONLY place tokens live
```

## Two trust levels

- **Secret** — `.secrets/keys.json` (0600). Read only by `_runtime/client.ts`, at call time.
  Tokens never touch `process.env` and only tool *results* return to the model.
- **Public** — everything under `mcp/`. The agent reads `identities.json` to know which
  identities exist (e.g. multiple Linear workspaces) without ever seeing a token.

## Multiple identities

A provider can carry several named identities. Resolution order when a tool runs:
explicit `{ identity }` arg → `MCP_IDENTITY_<provider>` env (name only) → configured
default → first available. Tokens are read fresh per call, so rotating the keyfile
out-of-band is picked up on the next call.

## Lifecycle (idempotent, deterministic)

```ts
import { addProvider, syncProvider, syncAll, removeProvider } from "./index.ts";

await addProvider(ws, { provider: "linear", url, identities, defaultIdentity });
await syncProvider(ws, "linear");   // re-introspect + diff one provider
await syncAll(ws);                  // update every installed provider (fail-soft)
removeProvider(ws, "linear");
```

Each add/sync returns a `SyncDiff` (`added` / `removed` / `changed` / `unchanged`).
Because codegen is deterministic, an unchanged sync rewrites nothing and reports no diff.

## CLI (stand-in for the provisioning endpoint)

```bash
bun run src/mcpgen/cli.ts add --workspace ./ws --provider linear \
  --url https://mcp.linear.com --identity acme:lin_xxx:Acme --default acme
bun run src/mcpgen/cli.ts sync --workspace ./ws --provider linear
bun run src/mcpgen/cli.ts sync-all --workspace ./ws
```

## Layout

| File | Role |
|---|---|
| `types.ts` | shared types + `GENERATOR_VERSION` |
| `introspect.ts` | network boundary: `connectMcp` → `listTools` (provision-time only) |
| `schema-ts.ts` | JSON-Schema → TypeScript for tool inputs |
| `templates.ts` / `docs.ts` | render wrappers/barrel and the public docs/SKILL |
| `emitted/client.ts` | the self-authenticating runtime client copied into each workspace |
| `keys.ts` / `manifest.ts` | secret keyfile and public manifest stores |
| `generate.ts` | deterministic per-provider (re)generation + diff |
| `workspace.ts` | lifecycle: add / sync / sync-all / remove + boundary validation |
| `cli.ts` | thin CLI entry |

## Station API

Provisioning is controlled over the Station REST API — MCP workspaces are ordinary
first-class Station workspaces, so they reuse the existing `WorkspaceStore`, session
creation, and namespace isolation.

| Method & path | Action |
|---|---|
| `POST /workspaces` | create a workspace (mints a managed folder when no `path` is given) |
| `POST /workspaces/:id/mcp` | install/refresh one provider — body `ProvisionMcpInput` → `McpSyncDiff` |
| `GET /workspaces/:id/mcp` | list installed providers (no tokens) |
| `POST /workspaces/:id/mcp/sync` | re-introspect + sync all providers (fail-soft) |
| `POST /workspaces/:id/mcp/:provider/sync` | sync one provider |
| `DELETE /workspaces/:id/mcp/:provider` | remove one provider |

Typical flow: `POST /workspaces` → `POST /workspaces/:id/mcp` (once per provider) →
then drive the workspace with the existing `POST /sessions { workspaceId }` and
`POST /sessions/:id/messages`. Wire types (`ProvisionMcpInput`, `McpSyncDiff`,
`McpProviderDto`) live in `src/station/contract.ts` and are vendored into
`@porkytheblack/glorp-client`.

Routing for these lives in `src/station/route-workspaces.ts`; the handlers in
`src/station/routes/mcp.ts`.

## Follow-ups

- Embedding `emitted/client.ts` into the compiled binary (mirror `scripts/embed-prompts.ts`)
  so provisioning works from `dist/glorp`, not just from source.
