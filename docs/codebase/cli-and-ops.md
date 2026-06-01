# CLI Entrypoints & Ops/Build

Technical reference for Glorp's command-line interface, its subcommand modules,
and the build / Docker / ops tooling that ships and runs the binary.

> Scope note: `cli-serve.ts`, `cli-station.ts`, and `cli-mesh.ts` appear in the
> dispatch table below but are documented in depth elsewhere. The deprecated
> `dashboard/` directory is intentionally not covered.

## Overview

Glorp is a single-binary CLI. There is exactly one process entrypoint,
`src/cli.ts`, which parses `process.argv`, selects a *command*, and lazily
imports the module that implements it. Every mode lives in its own
`src/cli-*.ts` file, deliberately kept small (the project targets ≤ 200 lines
per file) and loaded on demand via dynamic `import()` so that, e.g., a one-shot
headless run never pays the cost of loading the TUI React stack.

Two thin shims front the same entrypoint:

- `bin/glorp.js` — the published npm `bin` (`package.json:7-9`). It is just
  `#!/usr/bin/env bun` + `import "../src/cli.ts"`; Bun handles TypeScript
  natively.
- `dist/glorp` — the compiled standalone binary produced by `bun build
  --compile` (see [Build pipeline](#build-pipeline)).

Version/codename constants live in `src/shared/version.ts`
(`GLORP_VERSION = "0.1.0"`, codename `First-Contact`, `GLORP_BUILD` from the
`GLORP_BUILD` env var, default `dev`).

## Command dispatch (`src/cli.ts`)

`main()` calls `parseCliArgs(process.argv.slice(2))` and `switch`es on
`args.command` (`src/cli.ts:11-70`). Each case dynamically imports its handler.
The top-level `main().catch(...)` prints `glorp crashed:` and exits `1` on any
unhandled rejection (`src/cli.ts:72-75`).

| Command / flag                | `args.command` | Handler module                          | Notes |
|-------------------------------|----------------|-----------------------------------------|-------|
| `-h`, `--help`                | `help`         | inline — prints `HELP_TEXT`             | `src/cli.ts:15-17` |
| `-v`, `--version`             | `version`      | inline — prints `glorp <version>`       | `src/cli.ts:19-21` |
| `serve`                       | `serve`        | `cli-serve.ts` → `runServe` *(other agent)* | |
| `migrate`                     | `migrate`      | `cli-migrate.ts` → `runMigrate`         | |
| `doctor` [`--kill`]           | `doctor`       | `cli-doctor.ts` → `runDoctor`           | |
| `mesh [agents\|log\|summary]` | `mesh`         | `cli-mesh.ts` → `runMesh` *(other agent)* | |
| `station ...`                 | `station`      | `cli-station.ts` → `runStation` *(other agent)* | |
| `station keys <add\|list\|revoke>` | `station` (+ `stationKeysSub`) | `cli-keys.ts` → `runKeys` | Routed before `runStation` when `args.stationKeysSub` is set (`src/cli.ts:48-52`) |
| `-p` / `--print "<prompt>"`   | `headless`     | `cli-headless.ts` → `runHeadless`       | |
| *(default — no command word)* | `tui`          | `cli-tui.ts` → `runTui`                 | Default when nothing else matches |

The default command is `tui` (`src/cli-args.ts:43`); running `glorp` with no
recognized subcommand drops into the interactive TUI in the current directory,
treating any bare arguments as an initial prompt.

## Argument parsing (`src/cli-args.ts`)

`parseCliArgs(argv)` returns a `CliArgs` object (`src/cli-args.ts:9-39`). It is a
hand-rolled single-pass scanner (`src/cli-args.ts:41-100`) — no third-party arg
library. Defaults are seeded first (`src/cli-args.ts:42-46`):

- `command: "tui"`
- `workspace: process.cwd()`
- `sessionId: ""`

### Command words

`serve`, `station`, `migrate`, `doctor`, `mesh` set `args.command`. Special
positional handling:

- `station keys <sub> [<name|id>]` — sets `stationKeysSub` to `add` / `revoke`
  (anything else ⇒ `list`), then consumes a following non-flag token as
  `keyName` (for `add`) or `keyId` (for `revoke`) (`src/cli-args.ts:50-65`).
- `mesh <sub>` — consumes the next non-flag token as `meshSub`
  (`src/cli-args.ts:68-73`).

### Flags

| Flag | Field | Default | Notes |
|------|-------|---------|-------|
| `-C`, `--cwd <dir>`        | `workspace`       | `process.cwd()` | `path.resolve`d |
| `-s`, `--session <id>`     | `sessionId`       | `""`            | Resume a session |
| `--provider <name>`        | `provider`        | unset           | `anthropic\|openai\|openrouter\|gemini\|…` |
| `-m`, `--model <name>`     | `model`           | unset           | Model override |
| `--port <port>`            | `port`            | unset (`Number(...)`) | serve: 3271, station: 4271 (set by the handlers) |
| `--token <token>`          | `token`           | unset           | Bearer token for server auth |
| `-p`, `--print <prompt>`   | `command=headless`, `prompt` | — | One-shot mode |
| `--auto-mode`              | `permissionMode`  | unset           | `"auto"` — auto-approve safe ops |
| `--bypass`                 | `permissionMode`  | unset           | `"bypass"` — no permission prompts |
| `--kill`                   | `doctorKill`      | `false`         | `doctor` only |
| `--host <addr>`            | `host`            | unset           | Station bind address |
| `--data-dir <dir>`         | `dataDir`         | unset           | Station state dir override |
| `--workspace-root <dir>`   | `workspaceRoot`   | unset           | `path.resolve`d; Station auto-provision base |
| `--scopes <a,b,c>`         | `scopes`          | unset           | Split on `,`, trimmed; for `keys add` |
| `--dashboard`              | `dashboard`       | `false`         | Serve the (deprecated) Dashboard SPA |
| `-h`, `--help`             | `command=help`    | — | |
| `-v`, `--version`          | `command=version` | — | |

Any remaining bare (non-`-`) token is appended to `args.prompt`, space-joined
(`src/cli-args.ts:95-97`), so `glorp fix the bug` and `glorp -p "fix the bug"`
both reach a handler with a prompt.

`PermissionMode` is imported from `src/agent/runtime/permission-mode.ts`.

### Help text

`HELP_TEXT` (`src/cli-args.ts:102-146`) is the canonical user-facing usage
string, also covering environment variables (`ANTHROPIC_API_KEY`, `GLORP_PORT`,
`GLORP_TOKEN`, `GLORP_DATA_DIR`, `GLORP_STATION_AUTH`) and the TUI keyboard
shortcuts.

## Subcommand modules

### `doctor` — `src/cli-doctor.ts`

Diagnoses and cleans up stale runtime state (`runDoctor`,
`src/cli-doctor.ts:49-93`):

1. Resolves the data dir (`GLORP_DATA_DIR` or `~/.glorp`).
2. Checks the registered server via `discoverServer(dataDir)`. Prints a live
   server line if found; otherwise removes a stale `server.json` whose process
   is gone (`src/cli-doctor.ts:53-63`).
3. Enumerates running glorp processes via `ps -axo pid=,rss=,etime=,command=`
   (`findGlorpProcesses`, `src/cli-doctor.ts:29-43`). `isGlorpProcess`
   (`src/cli-doctor.ts:22-27`) matches the `glorp` binary, the `src/cli.ts` dev
   entrypoint, and spawned `agent-entrypoint` subprocesses while excluding the
   doctor's own `ps`/`grep` lines.
4. With `--kill` (`args.doctorKill`), sends `SIGTERM`, waits 800 ms, then
   `SIGKILL`s survivors, and clears any now-stale `server.json`
   (`src/cli-doctor.ts:74-86`). Without it, prints a hint to re-run with
   `--kill`.

Purpose: recover from a runaway/abandoned glorp (the classic "zsh: killed glorp"
on next launch).

### `headless` one-shot — `src/cli-headless.ts`

Triggered by `-p`/`--print`. Connects to a server, sends one prompt, streams the
result to stdout, exits (`runHeadless`, `src/cli-headless.ts:17-91`):

1. Requires a prompt (exits `2` if missing, `src/cli-headless.ts:18-21`).
2. Ensures the data dir exists; finds an existing server via `discoverServer`,
   or starts an **embedded** one via `startServer(...)` (port from `--port` or
   `GLORP_PORT`), passing provider/model/token/permissionMode through
   (`src/cli-headless.ts:26-42`).
3. Creates a `GlorpClient` (`clientName: "glorp-headless"`), creates/resumes a
   session, subscribes, and streams events: `text_delta` → stdout,
   `tool_started`/`tool_finished` → bracketed tool lines, `error` → stderr
   (`src/cli-headless.ts:44-85`).
4. Resolves when the agent turn completes and the server goes non-busy. Hard
   5-minute timeout (`300_000` ms). Always disconnects the client and stops the
   embedded server in `finally`.

### `keys` — `src/cli-keys.ts`

`glorp station keys <add|list|revoke>` operates **directly on the on-disk key
store** — no running server required, which is how the very first key is minted
(`runKeys`, `src/cli-keys.ts:13-50`). It loads `loadStationConfig({ dataDir })`
and opens a `KeyStore` at `config.auth.keyStorage` or
`<dataDir>/glorp-keys.json`.

- `add` — requires `keyName`; `store.create(name, scopes)`. The raw key is
  printed **once** to **stdout** (so it can be piped); all human-readable text
  goes to **stderr** (`src/cli-keys.ts:18-26`).
- `revoke` — requires `keyId`; exits `1` if no such key.
- `list` (default) — prints `id  prefix…  name  [scopes  last_used  revoked?]`.

The store is always closed in `finally`.

### `migrate` — `src/cli-migrate.ts`

`glorp migrate` eagerly upgrades every persisted store to the current schema
(migrations also run lazily on load; this is the proactive whole-store pass)
(`runMigrate`, `src/cli-migrate.ts:14-31`). It prints the current
session/roster schema versions, runs `migrateAllSessions(dataDir)`, lists each
migrated file with its `vN → vM` transition, and prints a tally
(`scanned / migrated / up-to-date / unowned / newer-than-build / errors`).
Documents written by a *newer* glorp are left untouched and flagged.

### `tui` — `src/cli-tui.ts`

The primary interactive experience (`runTui`, `src/cli-tui.ts:20-108`):

1. Ensures the data dir; opens a `CredentialsStore`. If no provider is supplied,
   none stored, and no provider env var is set (`envHasProvider`,
   `src/cli-tui.ts:127-132` — checks `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
   `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`), it runs the
   `Onboarding` flow first (`src/cli-tui.ts:26-29`, `110-125`).
2. Reuses an existing server **only if its workspace matches** the requested
   one; otherwise starts an embedded server (`src/cli-tui.ts:34-47`).
3. Creates a `GlorpClient`, resolves the session id (explicit `-s` > most-recent
   project session > a fresh `newSessionId()`), and creates/resumes it
   (`src/cli-tui.ts:56-67`).
4. Mounts the React TUI (`@opentui/core` + `@opentui/react`) via a lazily
   imported `App` (`src/tui/app.tsx`). Wires `onQuit` / `onSwapSession`
   handlers, sends an initial prompt if one was supplied, and tracks busy state
   so `SIGINT` aborts an in-flight turn instead of quitting
   (`src/cli-tui.ts:70-107`).

## Build pipeline

Defined in `package.json:35-51`. Bun is the toolchain (`engines.bun >= 1.3.0`).

### Compile to a single binary

```
bun run prebuild   # bun scripts/embed-prompts.ts
bun run build      # prebuild + build:dashboard + bun build --compile → dist/glorp
```

- `prebuild` (`package.json:38`) runs `scripts/embed-prompts.ts`.
- `build` (`package.json:39`) = `prebuild` + `build:dashboard` +
  `bun build src/cli.ts --compile --minify --target=bun --outfile=dist/glorp`.
- `build:cli` (`package.json:40`) is the same compile **without** the dashboard
  step — the lean path used for the Docker single-binary variant.

### Prompt embedding — `scripts/embed-prompts.ts`

The compiled binary can't `readFileSync` from its virtual FS, so this pre-build
step reads the agent prompt `.md` files (`src/agent/prompts/...`: the seven
`agents/*.md` role prompts plus `compaction.md` and `skill-instructions.md`,
`scripts/embed-prompts.ts:17-27`) and writes them as JSON-escaped string
literals into a generated `src/agent/prompts/embedded.ts`
(`export const EMBEDDED: Record<string, string>`,
`scripts/embed-prompts.ts:36-44`). The file is marked
`@generated ... DO NOT EDIT`.

### Install — `scripts/install.sh`

`bun run install-bin` (`package.json:41`) runs `scripts/install.sh`, which
copies `dist/glorp` (override via `SRC`) onto `$PATH`: `INSTALL_DIR` if set,
else `$PREFIX/bin` (default `/usr/local/bin`) when writable, else
`~/.local/bin` (`scripts/install.sh:21-28`). It `chmod +x`es the binary, copies
the built dashboard SPA into `<data dir>/dashboard` (the compiled binary can't
serve it from the virtual FS, `scripts/install.sh:37-49`), then verifies and
warns if the destination isn't on `$PATH`.

## Other scripts

| Script | npm script | Purpose |
|--------|-----------|---------|
| `scripts/bench-conventions.ts` | `bench:conventions` (`package.json:44`) | Convention-loading "landmine" benchmark. Creates fresh fixtures, runs glorp headless (`src/cli.ts -C <root> -p <CONVENTION_PROMPT>`, `scripts/bench-conventions.ts:88-93`), grades each run, prints a pass-rate table or `--json`. Flags: `--runs`, `--provider`, `--model`, `--agent-command`, `--timeout-ms` (default 600 000), `--json`, `--keep`. |
| `scripts/test-orchestrator.sh` | `test:orchestrator` (`package.json:47`) | Full orchestrator workflow gate: typecheck, ≤ 200-line ceiling on orchestrator files, orchestrator unit tests, full suite, and a barrel-export check on `src/orchestrator/index.ts`. Non-zero exit on any failure. |

## npm / bun scripts (`package.json`)

| Script | Command | Purpose |
|--------|---------|---------|
| `start`       | `bun run src/cli.ts` | Run from source |
| `dev`         | `bun run --watch src/cli.ts` | Watch-mode dev |
| `prebuild`    | `bun scripts/embed-prompts.ts` | Embed prompts (auto-runs before `build`) |
| `build`       | `prebuild` + `build:dashboard` + `bun build --compile … → dist/glorp` | Full binary incl. dashboard |
| `build:cli`   | `prebuild` + `bun build --compile … → dist/glorp` | Binary, no dashboard |
| `install-bin` | `bash scripts/install.sh` | Install `dist/glorp` onto `$PATH` |
| `build:dashboard` | `cd dashboard && bun install && bun run build` | Build SPA (deprecated area) |
| `dashboard:dev`   | `cd dashboard && bun run dev` | Dashboard dev server (deprecated area) |
| `bench:conventions` | `bun scripts/bench-conventions.ts` | Convention benchmark |
| `typecheck`   | `tsc --noEmit` | Type checking |
| `test`        | `bun test tests/` | Test suite |
| `test:orchestrator` | `bash scripts/test-orchestrator.sh` | Orchestrator gate |
| `client:sync`  | `bun packages/glorp-client/scripts/sync-contract.ts` | Regenerate client contract |
| `client:check` | `… sync-contract.ts --check` | Verify client contract is in sync |
| `ci`          | `typecheck && client:check && test` | The recipe CI runs |

## Docker / Compose deployment

The image packages **Glorp Station in a box** — a sandboxed runtime where agents
freely run tools (`bash`, file writes, package installs, `git`) inside the
container against `/workspaces`, never touching the host. See `docs/docker.md`
for the full operator guide.

### `Dockerfile`

- Base `oven/bun:1.3`; installs `git ca-certificates curl python3` for the
  agent's sandbox toolchain (`Dockerfile:4-10`).
- Installs deps from `package.json` + `bun.lock` with `--frozen-lockfile`
  (layer-cached), copies source, runs `bun run prebuild` (embeds prompts)
  (`Dockerfile:14-20`). The image runs Station **from source**, not from a
  compiled binary.
- Env: `GLORP_DATA_DIR=/data`, `GLORP_STATION_AUTH=required`, `GLORP_AUTO_KEY=1`
  (`Dockerfile:24-26`).
- Volumes `/data` (keys + session snapshots) and `/workspaces` (isolated agent
  working dirs); `EXPOSE 4271` (`Dockerfile:27-29`).
- `ENTRYPOINT ["bash", "/app/docker/entrypoint.sh"]` with
  `CMD ["--host", "0.0.0.0", "--port", "4271", "--workspace-root",
  "/workspaces"]` (`Dockerfile:31-32`).

### `docker/entrypoint.sh`

On first boot, if auth is on (`GLORP_STATION_AUTH != off`), `GLORP_AUTO_KEY=1`,
the command isn't `keys`, and no `glorp-keys.json` exists yet, it auto-mints an
admin key via `bun run src/cli.ts station keys add docker --scopes admin`
(printed to the logs), then `exec`s `bun run src/cli.ts station "$@"`
(`docker/entrypoint.sh:9-21`). `set -euo pipefail`.

### `docker-compose.yml`

Service `glorp` (`docker-compose.yml:7-35`): `build: .`, image `glorp-station`,
publishes `4271:4271`. Passes through `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` /
`OPENROUTER_API_KEY` and forces `GLORP_STATION_AUTH=required` + `GLORP_AUTO_KEY=1`.
Named volumes `glorp-data:/data` and `glorp-workspaces:/workspaces` persist
across `docker compose down` (wiped only with `-v`). Has a `/api/v1/health`
healthcheck and `restart: unless-stopped`. Commented-out `mem_limit` / `cpus` /
`pids_limit` guardrails and an optional read-only `credentials.json` bind mount
for custom providers.

Quick start: `ANTHROPIC_API_KEY=… docker compose up -d --build`, then
`docker compose logs | grep glsk_` for the auto-minted key.

### `.dockerignore`

Keeps the build context small and prevents host state from leaking into the
image: `.git`, `.claude`, `.glorp`, all `node_modules`/`dist` trees,
`dashboard/dist`, `packages/glorp-client/dist`, logs, `*.tsbuildinfo`,
`.DS_Store`, and `.env*` (`.dockerignore`).

## Key files

| Path | Role |
|------|------|
| `src/cli.ts` | Single entrypoint; parses args, dispatches to a command module |
| `src/cli-args.ts` | `parseCliArgs`, the `CliArgs` interface, and `HELP_TEXT` |
| `src/cli-doctor.ts` | `glorp doctor [--kill]` — diagnose/clean stale processes & `server.json` |
| `src/cli-headless.ts` | `glorp -p` one-shot; streams one prompt's result to stdout |
| `src/cli-keys.ts` | `glorp station keys add\|list\|revoke` over the on-disk key store |
| `src/cli-migrate.ts` | `glorp migrate` — eager whole-store schema upgrade |
| `src/cli-tui.ts` | `runTui` — interactive TUI (default command), onboarding, session resume |
| `src/cli-serve.ts` | `glorp serve` — server only *(documented elsewhere)* |
| `src/cli-station.ts` | `glorp station` — multi-session runtime *(documented elsewhere)* |
| `src/cli-mesh.ts` | `glorp mesh` — inter-agent mesh inspection *(documented elsewhere)* |
| `src/shared/version.ts` | `GLORP_VERSION`, codename, build constants |
| `bin/glorp.js` | npm `bin` shim → `src/cli.ts` |
| `package.json` | Scripts (build/typecheck/test/ci), `bin`, deps, `engines.bun >= 1.3.0` |
| `scripts/embed-prompts.ts` | Pre-build: embeds prompt `.md` → `src/agent/prompts/embedded.ts` |
| `scripts/install.sh` | Install `dist/glorp` (+ dashboard SPA) onto `$PATH` |
| `scripts/bench-conventions.ts` | Convention-loading benchmark harness |
| `scripts/test-orchestrator.sh` | Orchestrator typecheck/tests/line-ceiling/barrel gate |
| `Dockerfile` | Station-in-a-box image (`oven/bun:1.3`, from source) |
| `docker-compose.yml` | Compose service, volumes, healthcheck, guardrails |
| `docker/entrypoint.sh` | First-boot key auto-mint, then `station "$@"` |
| `.dockerignore` | Trims build context / blocks host state |
| `docs/docker.md` | Operator guide for the containerized Station |
