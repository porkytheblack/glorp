# Glorp Codebase Reference

Code-level internals documentation for the Glorp source tree. These docs describe
**how the code is structured and works**, complementing the user-facing guides in
[`../`](../) (garage usage/spec, docker, the OpenAPI schema).

> **Scope note.** The `dashboard/` web frontend is intentionally **not documented
> here** — it is being deprecated. Everything else under `src/` and `packages/` is
> covered by the references below.

## Map

| Doc | Subsystem | Source covered |
|---|---|---|
| [agent.md](./agent.md) | **Agent core & tools** — how a session is built, the coding-tool suite, subagents, prompts, persona, store/persistence | `src/agent/**` |
| [tui.md](./tui.md) | **TUI frontend** — OpenTUI/React layout, the bridge wire-events, state reducer, components | `src/tui/**`, `src/ui/**`, `src/shared/**` |
| [orchestrator.md](./orchestrator.md) | **Orchestrator & mesh** — the generate-evaluate loop, roles/blueprints, agent spawning, filesystem mesh | `src/orchestrator/**`, `src/agent/glorp.ts` |
| [networking.md](./networking.md) | **Networking & client SDK** — REST + WebSocket server, in-repo client, the standalone `@porkytheblack/glorp-client` SDK, wire protocol | `src/server/**`, `src/client/**`, `src/protocol/**`, `packages/glorp-client/**` |
| [garage-internals.md](./garage-internals.md) | **Garage runtime internals** — route handlers, auth/KeyStore, session/workspace lifecycle, credentials (code-level companion to `../garage-usage.md`) | `src/garage/**`, `src/cli-garage.ts` |
| [cli-and-ops.md](./cli-and-ops.md) | **CLI & ops** — the `cli.ts` dispatch, arg parsing, subcommands, build pipeline, Docker/compose | `src/cli*.ts`, `Dockerfile`, `docker-compose.yml`, `scripts/**` |

## Notes flagged during documentation

A few places where the current code has drifted from the README or has internal
inconsistencies — recorded here so they aren't lost, and detailed in the linked docs:

- **The `station-signal` fleet is gone.** There is no `src/agent/fleet/`,
  `station-bridge.ts`, `memory-store-shim.ts`, or `dispatch_fleet` tool. Async
  fan-out is now the `src/orchestrator/` mesh driven by the `spawn_agent` tool.
  The README's "Async fleet" / `dispatch_fleet` sections are stale. See
  [agent.md](./agent.md) and [orchestrator.md](./orchestrator.md).
- **Two parallel TUI frontends.** `src/tui/` is the active one (mounted by
  `cli-tui.ts`, driven over the WebSocket client); the older `src/ui/` tree — which
  the README "Layout" section actually describes — still drives the same reducer
  off the in-process bridge. See [tui.md](./tui.md).
- **Two servers, two protocols.** The in-repo `src/server/` (port 3271, `/ws`,
  `?token=`) and the standalone SDK's Garage target (port 4271, `/api/v1/...`,
  `?api_key=`) are different APIs with different framing. See [networking.md](./networking.md).
- **`maxAgents` discrepancy.** Default is `5` in code (`orchestrator.ts`) vs the `8`
  in the `types.ts` comment. See [orchestrator.md](./orchestrator.md).
- **`glorp mesh` is read-only.** `cli-mesh.ts` is an observability command, not the
  orchestrator driver; the wiring lives in `src/agent/glorp.ts`. See
  [orchestrator.md](./orchestrator.md).
