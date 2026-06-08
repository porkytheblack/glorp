# Garage Dashboard

A clean, professional console for the Glorp **Garage** orchestration layer. It
talks directly to a running Garage server's REST + WebSocket API and gives you
live observability and control over the core primitives:

- **Sessions** — list, create, destroy, and watch a session's live event stream;
  send messages and abort runs.
- **Agents** — inspect and manage a session's multi-agent roster.
- **Messages** — the agent's latest answer and task list per session.
- **Namespaces** — create/delete tenant partitions and mint namespace-bound keys.
- **Workspaces** — manage the host directories sessions run against.
- **Provisioning** — launch sessions from declarative setup templates.
- **Credentials** — model providers and the profiles sessions inherit.
- **API Keys** — mint/revoke keys for the REST API and the MCP server.

## Auth

The dashboard signs in with the admin identity provisioned on the Garage server:

```bash
export GARAGE_ADMIN_USER=admin
export GARAGE_ADMIN_PASSWORD=change-me
export GARAGE_JWT_SECRET=$(openssl rand -hex 32)   # optional; derived from the password if unset
```

Login exchanges these for a short-lived JWT, which the browser then sends as a
Bearer token on every API request (and as `?api_key=` on the WebSocket).

## Run

```bash
cd dashboard
cp .env.example .env.local         # point NEXT_PUBLIC_GARAGE_URL at your Garage
npm install
npm run dev                        # http://localhost:3270

# in another terminal, with admin env vars set:
glorp garage                       # the Garage API on http://127.0.0.1:4271
```

For a non-loopback Garage bind, API-key auth is enforced automatically — the
admin JWT satisfies it (admin scope). On loopback, the API is open but the
dashboard still requires login when admin credentials are configured.

## Build

```bash
npm run build && npm run start
```

The dashboard holds no server-side secrets: it is a pure client of the Garage
API, configured at runtime via `NEXT_PUBLIC_GARAGE_URL`.
