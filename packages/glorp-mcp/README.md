# @porkytheblack/glorp-mcp

An [MCP](https://modelcontextprotocol.io) server that exposes a remote
[Glorp](https://github.com/porkytheblack/glorp) Station — **namespaces,
workspaces, sessions, and the multi-agent roster** — as tools any MCP-capable
agent (Claude Desktop/Code, Cursor, custom orchestrators) can call.

It's a thin wrapper over [`@porkytheblack/glorp-client`](../glorp-client): the
Station still enforces auth and tenant isolation; this just speaks MCP.

## Configure

| Env | Required | Purpose |
| --- | --- | --- |
| `GLORP_ENDPOINT` | ✅ | Station base URL, e.g. `https://glorp.example.com` |
| `GLORP_API_KEY` | – | Admin key (for orchestration) or a namespace-bound tenant key |
| `GLORP_NAMESPACE` | – | Pin every call to this namespace (admin proxy) |
| `MCP_AUTH_TOKEN` | – | HTTP transport only: require `Authorization: Bearer` on `/mcp` |

## Run

```bash
# stdio (default) — what local agent clients spawn
GLORP_ENDPOINT=https://glorp.example.com GLORP_API_KEY=glsk_… npx @porkytheblack/glorp-mcp

# streamable HTTP (remote / multi-client)
npx @porkytheblack/glorp-mcp --http --host 0.0.0.0 --port 8787   # POST /mcp
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

**Orchestration (admin key):** `glorp_list_namespaces`, `glorp_get_namespace`,
`glorp_create_namespace`, `glorp_delete_namespace`, `glorp_mint_namespace_key`,
`glorp_list_namespace_keys`.

**Workspaces:** `glorp_list_workspaces`, `glorp_create_workspace`, `glorp_delete_workspace`.

**Sessions:** `glorp_run` (create + prompt + wait), `glorp_list_sessions`,
`glorp_get_session`, `glorp_send_message`, `glorp_session_result`,
`glorp_abort_session`, `glorp_destroy_session`.

**Agents (roster):** `glorp_list_agents`, `glorp_add_agent`, `glorp_switch_agent`,
`glorp_remove_agent`.

Admin tools simply fail with a clear `403` if the configured key isn't admin — the
Station enforces scope. Every workspace/session/agent tool takes an optional
`namespace` arg so an admin key can act inside a specific tenant.

## Quick start

```text
glorp_create_namespace { "name": "Acme" }                 -> { "id": "ns_acme" }
glorp_mint_namespace_key { "id": "ns_acme", "name": "bot" } -> { "key": "glsk_…" }
glorp_run { "prompt": "Scaffold a TS lib and test it", "namespace": "ns_acme" }
```
