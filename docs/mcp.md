# Glorp MCP server

[`@porkytheblack/glorp-mcp`](../packages/glorp-mcp/README.md) is an
[MCP](https://modelcontextprotocol.io) server that exposes a remote Glorp Station
— **namespaces, workspaces, sessions, and the multi-agent roster** — as tools any
MCP-capable agent (Claude Desktop/Code, Cursor, custom orchestrators) can call.

It's a thin wrapper over [`@porkytheblack/glorp-client`](../packages/glorp-client/README.md):
the Station still enforces auth and tenant isolation; this just speaks MCP.

```text
┌─ MCP agent ─────────┐   MCP    ┌─ glorp-mcp ─┐   HTTP/WS   ┌─ Glorp Station ─┐
│ Claude Code / Desk- │ ───────▶ │ tools →     │ ──────────▶ │ namespaces,     │
│ top / Cursor / …    │ stdio /  │ glorp-client│  (api key)  │ sessions, agents│
└─────────────────────┘  HTTP    └─────────────┘             └─────────────────┘
```

## Configure

| Env | Required | Purpose |
| --- | --- | --- |
| `GLORP_ENDPOINT` | ✅ | Station base URL, e.g. `https://glorp.example.com` |
| `GLORP_API_KEY` | – | Admin key (orchestration) or a namespace-bound tenant key |
| `GLORP_NAMESPACE` | – | Pin every call to this namespace (admin proxy) |
| `MCP_AUTH_TOKEN` | – | HTTP transport only: require `Authorization: Bearer` on `/mcp` |

## Run

```bash
# stdio (default) — what local agent clients spawn
GLORP_ENDPOINT=https://glorp.example.com GLORP_API_KEY=glsk_… npx @porkytheblack/glorp-mcp

# streamable HTTP (remote / multi-client) — POST /mcp
npx @porkytheblack/glorp-mcp --http --host 0.0.0.0 --port 8787
```

### Claude Desktop / Code (stdio)

```jsonc
{
  "mcpServers": {
    "glorp": {
      "command": "npx",
      "args": ["-y", "@porkytheblack/glorp-mcp"],
      "env": { "GLORP_ENDPOINT": "https://glorp.example.com", "GLORP_API_KEY": "glsk_…" }
    }
  }
}
```

## Tools

- **Orchestration (admin key):** `glorp_list_namespaces`, `glorp_get_namespace`,
  `glorp_create_namespace`, `glorp_delete_namespace`, `glorp_mint_namespace_key`,
  `glorp_list_namespace_keys`.
- **Workspaces:** `glorp_list_workspaces`, `glorp_create_workspace`, `glorp_delete_workspace`.
- **Sessions:** `glorp_run` (create + prompt + wait), `glorp_list_sessions`,
  `glorp_get_session`, `glorp_send_message`, `glorp_session_result`,
  `glorp_abort_session`, `glorp_destroy_session`.
- **Agents (roster):** `glorp_list_agents`, `glorp_add_agent`, `glorp_switch_agent`,
  `glorp_remove_agent`.

Admin tools fail with a clean `403` if the configured key isn't admin — the
Station enforces scope. Every workspace/session/agent tool takes an optional
`namespace` arg so an admin key can act inside a specific tenant.

## Security notes

- Namespaces require the Station to run with **auth on** (non-loopback bind or
  `GLORP_STATION_AUTH=required`).
- The HTTP transport is **unauthenticated unless `MCP_AUTH_TOKEN` is set** — set it
  for anything reachable over a network, and terminate TLS at a reverse proxy.
- Give the server a **namespace-bound tenant key** (not an admin key) when the
  connected agent shouldn't manage tenants.

See [`remote-orchestration.md`](./remote-orchestration.md) for the underlying REST/WS
API and [`openapi.yaml`](./openapi.yaml) for the machine-readable contract.
