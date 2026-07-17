# Custom MCP servers

Glorp can bridge any [MCP](https://modelcontextprotocol.io) server that speaks
the **streamable HTTP** transport into a coding session via
[`glove-mcp`](https://github.com/porkytheblack/glove). Each server's tools show
up in the agent's tool list as `<id>__<tool>` (e.g. `linear__search_issues`),
and the TUI gets a live MCP panel (`Ctrl+E` / `/mcp`).

> Looking for the *other* direction — driving a remote Glorp Garage *from*
> Claude / Cursor? That's [`@porkytheblack/glorp-mcp`](./mcp.md).

## Configure

Add an `mcp` section to any [config layer](../src/agent/project-config.ts)
(`<workspace>/glorp.json`, `<workspace>/.glorp/config.json`,
`~/.config/glorp/config.json`, or `~/.glorp/config.json`):

```jsonc
{
  "mcp": {
    "linear": {
      "url": "https://mcp.linear.app/mcp",
      "auth": "{env:LINEAR_MCP_TOKEN}",       // bearer token; {env:} / {file:} interpolated
      "description": "Linear issues and projects",
      "tags": ["issues", "projects"]
    },
    "internal-docs": {
      "url": "https://docs.corp.example/mcp",
      "autoConnect": false                    // listed, but only connects on demand
    }
  }
}
```

Per-server fields:

| Field | Default | Purpose |
| --- | --- | --- |
| `url` | — (required) | Streamable-HTTP MCP endpoint. `http(s)://` only. |
| `auth` | none | Bearer token. Use `{env:VAR}` or `{file:PATH}` to keep secrets out of the file. |
| `name` | the entry id | Display name in the TUI. |
| `description` | derived from url | Shown in the panel; also used by the discovery subagent for matching. |
| `tags` | none | Matching hints for discovery + panel filtering. |
| `enabled` | `true` | `false` hides the server from the catalogue entirely. |
| `autoConnect` | `true` | `false` lists the server without connecting at session start. |

Layers merge per-server, per-field — a workspace `glorp.json` can override just
the `url` of a server whose token lives in the home config.

## How it behaves

- **Session start** — every `autoConnect` server is connected, its tools are
  bridged onto the agent, and failures degrade to an `error` badge in the MCP
  panel (a down server never blocks the session). Connects time out after 10s.
- **TUI panel** — `Ctrl+E` or `/mcp` opens the roster: connection state, tool
  counts, errors. `Enter` toggles a server; the live agent is rebuilt so the
  bridged tool set always matches (glove-mcp v1 cannot unload tools from a
  running agent). The context rail shows a compact `MCP n/m · Nt` section, and
  the `Ctrl+K` palette gets per-server connect/disconnect commands.
- **Discovery** — the `discovermcp` subagent is registered automatically. The
  model can activate a configured-but-inactive server mid-conversation ("check
  our Linear board" → discovery finds + activates `linear`). Ambiguity resolves
  `auto-pick-best` (glorp runs Glove in server mode).
- **Persistence** — the active set is stored per session
  (`~/.glorp/sessions/<id>/mcp.json`), so a disconnect sticks across restarts
  of the same session; new sessions start from the config defaults.
- **Tool calls** — MCP calls render in the transcript as `⌁ server · tool`
  cards with duration. A `401` from the server surfaces as an `auth_expired`
  tool error — refresh the token behind `{env:…}`/`{file:…}` and reconnect
  from the panel.

## Limits (v1)

- HTTP transport only — no stdio servers (glove-mcp v1). Front a local stdio
  server with an HTTP gateway (e.g. `mcp-proxy`) if you need one.
- Bearer auth only; glorp does not run OAuth flows for MCP servers.
- Bridged tools run in Glove server mode and are not gated by glorp's
  permission prompts — only configure servers you trust.
