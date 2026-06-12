# Running Glorp Garage in Docker

Yes — Garage runs well in a container, and a container is the right place to
**let agents loose**: every tool the agent runs (bash, file writes, `npm`/`bun`
installs, `git`) happens *inside* the container against `/workspaces`, never on
your host. You talk to it over the same API-key-secured HTTP/WS API.

```
┌─ your machine ──────────┐        ┌─ container (the sandbox) ─────────────┐
│ orchestration / kit /   │  HTTP  │ glorp garage  ──▶ agent ──▶ bash,    │
│ curl  (GLORP_API_KEY)   │ ─────▶ │   :4271 (auth)      write, git, tests │
└─────────────────────────┘   WS   │   /data  /workspaces (volumes)        │
                                   └───────────────────────────────────────┘
```

## Prebuilt images (GHCR)

CI publishes three images on every push to `main` (and `v*` tags):

```bash
docker pull ghcr.io/porkytheblack/glorp/garage:latest           # lean Garage API
docker pull ghcr.io/porkytheblack/glorp/garage-full:latest      # + media/document toolchain
docker pull ghcr.io/porkytheblack/glorp/garage-allinone:latest  # Garage + dashboard + MCP + companion
```

(The pre-rename `station`/`station-full` names are frozen — new pushes land on
the `garage*` names only.) The dashboard's Garage URL is a **runtime** setting:
set the `GARAGE_URL` env on the container and the published image points at any
Garage without a rebuild (defaults to `http://localhost:4271` for local
published-port runs).

## Quick start

```bash
# from the repo root
ANTHROPIC_API_KEY=sk-ant-… docker compose up -d --build

# grab the API key it minted on first boot
docker compose logs | grep glsk_
```

Then drive it from your machine (any language via the REST/WS API, or the kit):

```bash
export GLORP_ENDPOINT=http://localhost:4271
export GLORP_API_KEY=glsk_…            # from the logs above
```

```ts
import { configure, run } from "@porkytheblack/glorp-client";
configure({ endpoint: process.env.GLORP_ENDPOINT, apiKey: process.env.GLORP_API_KEY });

// permissionMode "bypass" = no prompts. Safe here — it's all inside the container.
const h = await run({ workspace: "/workspaces/demo", prompt: "Scaffold a TS lib with a test and run it.", permissionMode: "bypass" });
console.log((await h.result()).text);
```

The agent's files land in the `glorp-workspaces` volume — inspect them with
`docker compose exec glorp ls -R /workspaces`.

## Credentials

Two ways to give the agent model access:

1. **Env vars** (standard providers): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
   `OPENROUTER_API_KEY`, … — set them in `docker compose` (already wired).
2. **Mount your `credentials.json`** (for custom providers / your existing
   profiles): uncomment in `docker-compose.yml`:
   ```yaml
   - ${HOME}/.glorp/credentials.json:/data/credentials.json:ro
   ```

## Why it's safe to "let it do stuff"

- **Filesystem isolation:** the agent only sees the container — `/app` (Garage),
  `/data` (keys/sessions), `/workspaces` (its scratch space). Your host files are
  untouched unless you bind-mount them.
- **`permissionMode: "bypass"`** is fine in here: no human-in-the-loop prompts,
  yet the hard-block guard still refuses `rm -rf /`, `sudo`, etc.
- **Auth on by default:** the port is API-key protected (auto-minted key). Set
  `GLORP_GARAGE_AUTH=off` only behind a private network/tunnel.
- **Guardrails:** uncomment `mem_limit` / `cpus` / `pids_limit` in the compose
  file to cap runaway runs. Add `--network none`-style policies if the agent
  shouldn't reach the internet (note: it needs outbound for model APIs).
- The workspace-cleanup guard means `?workspace=true` only deletes Garage's own
  `/workspaces/<id>` sandboxes, never a mounted project.

## Managing keys

```bash
docker compose exec glorp bun run src/cli.ts garage keys add ci --scopes run
docker compose exec glorp bun run src/cli.ts garage keys list
docker compose exec glorp bun run src/cli.ts garage keys revoke <id>
```

## Persisting / resetting

State lives in the `glorp-data` and `glorp-workspaces` named volumes.
`docker compose down` keeps them; `docker compose down -v` wipes them (fresh
keys + empty workspaces next boot).

## Batteries-included image (media + documents + skills)

The default `Dockerfile` is lean — good when you only orchestrate. For agents
that need to **create documents, video, images, or audio**, build the full
variant, which bakes in the whole toolchain so sessions can produce real
deliverables with zero setup:

```bash
docker build -f docker/Dockerfile.full -t glorp-garage:full .
docker run -d --name glorp -p 4271:4271 \
  -v glorp-data:/data -v glorp-workspaces:/workspaces \
  -v "$HOME/.glorp/credentials.json:/data/credentials.json:ro" \
  glorp-garage:full
```

What's inside (`docker/Dockerfile.full`, ~3.4 GB):

- **Runtimes:** Node 20 + npm, Python 3 + pip, Rust (rustup), plus the base `bun`.
- **Documents:** LibreOffice (headless docx/pptx/xlsx ↔ pdf), pandoc, poppler,
  ghostscript, qpdf; Python `python-pptx` / `python-docx` / `openpyxl` /
  `pypdf` / `pdfplumber` / `reportlab` / `weasyprint`.
- **Video / audio:** ffmpeg, sox, lame.
- **Images:** ImageMagick, libvips, webp, optipng, jpegoptim, Pillow.
- **Fonts:** DejaVu, Liberation, Noto (incl. CJK + colour emoji).
- **Skills:** the Anthropic agent skills (`docx`, `pptx`, `pdf`, `xlsx`, and more)
  installed into `~/.agents/skills/` so Glorp's extensions-loader surfaces them
  for **every** session. Wire your own source in `docker/skills-install.sh`
  (override `ANTHROPIC_SKILLS_REPO`). Install is **best-effort**: if the clone
  fails at build time the image still builds but the bundles may be absent — fetch
  them later by re-running `docker/skills-install.sh` in the container (or
  rebuilding with a reachable `ANTHROPIC_SKILLS_REPO`).

## All-in-one image (Garage + MCP + dashboard + companion)

The default image runs **only** the Garage API — the right call when you drive it
from your own code or the kit. If instead you want one container that is a
self-hosted Claude-Code-web — the **MCP server**, the **web dashboard**, and the
**companion service** (GitHub App git tokens + a template registry) — build the
all-in-one variant (`docker/Dockerfile.allinone`):

```bash
docker compose -f docker-compose.allinone.yml up -d --build

# grab the admin API key minted on first boot (used for REST + MCP)
docker compose -f docker-compose.allinone.yml logs | grep -A2 "Admin API key"
```

One container, four services (companion is loopback-internal):

```text
┌─ container ────────────────────────────────────────────────┐
│  glorp garage    ─ REST/WS API ........... :4271            │
│      ▲   ▲   ▲                                              │
│      │   │   └ dashboard (Next.js console) :3270 ─▶ browser │
│      │   └──── glorp-mcp (streamable HTTP) :8787 /mcp       │
│      └──▶ glorp companion (tokens+registry):8788 internal   │
│  /data  /workspaces (volumes)                               │
└────────────────────────────────────────────────────────────┘
```

- **Dashboard** — open <http://localhost:3270> and sign in with
  `GARAGE_ADMIN_USER` / `GARAGE_ADMIN_PASSWORD` (verified by Garage; **change the
  defaults**). Set a strong `GARAGE_JWT_SECRET` in production.
- **MCP** — point any MCP-capable agent at `http://localhost:8787/mcp` (POST /
  streamable HTTP). Inside the container the server is auto-wired to Garage with
  the minted admin key; set `MCP_AUTH_TOKEN` to require a Bearer token on the
  endpoint itself.
- **Garage API** — `http://localhost:4271`, same as the lean image.
- **Companion** — runs internally on `:8788`; Garage is auto-wired to it. Drop
  Template v2 documents (and `skills/` libraries) into the `glorp-data` volume at
  `/data/companion-templates` and they appear in the dashboard's template picker
  with skills resolved. Provide `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` (PEM or
  base64; or mount a file and set `GITHUB_APP_PRIVATE_KEY_FILE`) and template
  repos with `auth: "github"` clone with short-lived installation tokens — pushes
  keep working via the `glorp __git-cred` helper. To use an **external** companion
  instead, set `GLORP_GARAGE_GIT_TOKEN_URL` / `GLORP_GARAGE_TEMPLATE_REGISTRY_URL`
  (+ `_HEADERS`) — they override the built-in wiring. See
  `docs/companion-service-spec.md`.

The entrypoint supervises all four: if any exits, the container stops so the
restart policy brings it back. Ports are configurable via `MCP_PORT` / `DASH_PORT`
/ `COMPANION_PORT` (remember to match the published `-p` mappings).

**Pick your service set with `GLORP_SERVICES`** (comma-separated; Garage is
always on). `garage,dashboard` gives you just the web console + API — no
companion, no MCP — and `docker-compose.web.yml` ships exactly that flavor:

```bash
docker compose -f docker-compose.web.yml up -d --build
```

Operator templates (`/data/templates`) still work in this flavor; only the
companion's registry and GitHub-App git tokens are absent (point the
`GLORP_GARAGE_*_URL` env vars at an external companion to add them back).

### Single-volume hosts (Railway, Fly, …)

Some platforms allow **one volume per service**. Mount it at a parent path and
nest both state dirs under it via env — no compose/image changes needed:

```text
volume mount path:      /glorp
GLORP_DATA_DIR:         /glorp/data
GLORP_WORKSPACE_ROOT:   /glorp/workspaces
```

Everything that must survive a redeploy (keys, sessions, credentials,
templates, workspaces) then lives in the single volume.

### Dashboard and Garage on different hosts

The dashboard is a pure browser client of Garage — your browser calls Garage
directly (REST + WebSocket). Nothing has to be hardcoded on either side:

- **Garage URL** — the sign-in screen shows where the dashboard is pointing
  ("Garage at … · Change") and saves a per-browser override, so one deployed
  dashboard reaches any Garage. To pre-fill it for everyone, set the
  `GARAGE_URL` env on the dashboard container (runtime — no rebuild), e.g.
  `https://garage.example.com`.
- **CORS** — when API-key auth is required (the default on a non-loopback
  bind), Garage accepts browsers from **any** origin: every data route demands
  a Bearer key, and unlike cookies a key never rides along from a foreign
  page, so the key is the gate. Set
  `GLORP_GARAGE_ALLOWED_ORIGINS=https://dash.example.com` only to restrict
  origins anyway. With `GLORP_GARAGE_AUTH=off` the strict
  same-origin/loopback rule stays, and the allowlist is **required** for a
  remote dashboard.

Serve both over HTTPS — an https dashboard cannot call an http Garage (mixed
content), and the event stream needs wss://. Garage and the
companion run from the compiled binary inside the image, so orchestrator subagents
and the git credential helper behave exactly as on a binary install.

### Plain `docker run`

```bash
docker build -f docker/Dockerfile.allinone -t glorp-allinone .
docker run -d --name glorp \
  -p 4271:4271 -p 3270:3270 -p 8787:8787 \
  -e ANTHROPIC_API_KEY=sk-ant-… \
  -e GARAGE_ADMIN_USER=admin -e GARAGE_ADMIN_PASSWORD='choose-a-password' \
  -v glorp-data:/data -v glorp-workspaces:/workspaces \
  glorp-allinone
```

### Browser URL & CORS

The dashboard talks to Garage **from your browser**. The URL it calls resolves
per request — first match wins:

1. the per-browser override saved from the sign-in screen,
2. the `GARAGE_URL` **env** on the container (runtime — the entrypoint writes
   it to `/runtime-config.js` at startup, so the published image needs no
   rebuild),
3. the `NEXT_PUBLIC_GARAGE_URL` baked at build time (build arg `GARAGE_URL`),
4. the dashboard page's **own hostname on port 4271** — exactly where the
   all-in-one publishes Garage, so opening the dashboard from another machine
   works with zero configuration.

Cross-origin browser requests are accepted whenever API-key auth is required
(Bearer keys don't ride cross-site the way cookies do — the key is the gate).
With auth **off**, only same-origin and loopback browsers are accepted;
extend that with `GLORP_GARAGE_ALLOWED_ORIGINS` (comma-separated; `*` for
any). Setting an explicit allowlist also restricts an auth-on Garage to just
those origins.

## Image notes

The lean image runs Garage from the compiled `dist/glorp` binary on the
`oven/bun` base. Agent
workspaces get a full JS toolchain: `bun`/`bunx` plus **Node 22 with `npm`,
`npx`, and corepack-managed `pnpm`/`yarn`** — so stacks that expect real node
(Next.js, remotion, npm lifecycle scripts) work out of the box. `git`, `curl`,
`python3` are installed too; extend the `apt-get` line for anything else. For a smaller runtime you can instead compile a
single binary (`bun run build:cli` → `dist/glorp`) in a build stage and copy it
into an `oven/bun` runtime image; keep `bun` + `git` in the runtime so the agent
can still build and test.
