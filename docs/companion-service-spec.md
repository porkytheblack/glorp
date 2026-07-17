# Garage Companion Service — wire spec (v1)

**Audience:** the agent/team implementing the companion service (the *server*).
**Counterparty:** Glorp Garage (the *client*). Garage's client half ships in
this repo (`src/garage/git-tokens.ts`, `src/garage/templates/remote.ts`), so
everything below is testable against real client behavior, not prose.

The companion service owns two things Garage deliberately does not:

1. **The GitHub App private key.** The service mints short-lived installation
   tokens; Garage *pulls* one whenever git needs auth. Garage never stores
   tokens (memory cache only) and never writes them to argv, disk, or
   `.git/config`.
2. **A template library.** The service hosts workspace setup templates
   (Template v2 documents); Garage reads them on demand and provisions
   workspaces from them. The service can generate, compose, or rotate
   templates however it wants — Garage only ever GETs.

Design principles the server must honor:

- **Stateless GETs.** Garage only issues `GET`s with static headers. No
  sessions, no handshakes, no callbacks.
- **The service is optional at runtime.** Garage must keep functioning when
  the service is down — so every endpoint failure must be *cheap*: fail fast
  with a real HTTP status, never hang. Put a timeout in front of GitHub.
- **Tokens are radioactive.** Never log them; never return them on anything
  but a 200.

---

## 1. Authentication (Garage → service)

Garage sends a static set of configured headers on every request (operator
sets `GLORP_GARAGE_GIT_TOKEN_HEADERS` / `…_TEMPLATE_REGISTRY_HEADERS` as a
JSON object, e.g. `{"authorization": "Bearer <key>"}`). The service should:

- Require a bearer key (or equivalent) on every endpoint. Respond `401` with
  the standard error body (§4) when absent/invalid.
- Treat the key as identifying one Garage deployment. If you want per-tenant
  scoping later, mint distinct keys — don't add request parameters.
  Garage supports this directly: a namespace can be provisioned with its own
  registry URL + headers (`template_registry` on `POST /namespaces`), so each
  tenant's requests carry its own key and you return that tenant's library.
  See [garage-usage.md → Per-namespace companions](./garage-usage.md#per-namespace-companions).

TLS is required in production. Garage will happily speak plain HTTP to
loopback for development.

## 2. Capability: git token minting

### 2.1 Endpoint

Garage is configured with a **full URL**, so the path is yours to choose.
Recommended:

```
GET /v1/git/token?repo={repo}
```

The operator configures Garage with the literal string
`https://svc.example.com/v1/git/token?repo={repo}`. Before each request
Garage replaces `{repo}` with the **URL-encoded** `owner/name` it is about to
access (e.g. `acme%2Fwidgets` — your framework's query parsing will hand you
the decoded `acme/widgets`). Contract details:

- If the configured URL contains no `{repo}`, Garage calls it verbatim — your
  service then returns an org-wide token. Support at least one of the two
  shapes; supporting both is recommended.
- `repo` may be **empty** (Garage could not derive `owner/name`, e.g. a
  non-GitHub URL). Return your broadest acceptable token or `404`.
- Garage caches per substituted URL, so two different repos are two cache
  entries; identical repos within the TTL never re-hit you.

### 2.2 Response — `200`

Any ONE of the following bodies (Garage's parser accepts all three):

```jsonc
{ "token": "ghs_…", "expires_at": "2026-06-11T09:30:00Z" }   // preferred
{ "access_token": "ghs_…", "expires_at": 1781256600 }        // epoch s or ms both OK
ghs_…                                                         // plain text, no expiry
```

- `expires_at` may be an ISO-8601 string or an epoch number (seconds or
  milliseconds — values `< 10^10` are read as seconds).
- **Send `expires_at`.** With it, Garage refreshes 5 minutes before expiry.
  Without it, Garage assumes the GitHub default and re-fetches after 50
  minutes — correct for installation tokens, wasteful for anything
  longer-lived.

### 2.3 Response — failures

| Status | Meaning to Garage | Server guidance |
|---|---|---|
| `401`/`403` | Service rejected Garage's key | Standard error body; never a token |
| `404` | No installation grants access to this repo | Best signal for "app not installed on owner/X" |
| `5xx` | Transient | Garage logs once and the git operation fails with a clean error; it will retry on the next git op |

Garage treats every non-200 identically (no token → the clone/fetch fails
with a redacted error), so use statuses for *your* observability, not for
client control flow.

### 2.4 What the server actually does (GitHub side)

1. Sign an app JWT with the private key (RS256, `iss` = app id, ≤10 min —
   cache it ~9).
2. Resolve the installation for the requested repo/owner
   (`GET /repos/{owner}/{repo}/installation` or by-owner). Cache
   installation ids; they're stable.
3. `POST /app/installations/{id}/access_tokens`. Pass
   `repositories: [name]` (and a minimal `permissions` object) when a `repo`
   was supplied — **scope down**; that is the whole point of the pull model.
4. Return `{token, expires_at}` straight from GitHub's response.
5. You MAY serve a still-fresh token from cache (keyed by installation +
   scope). If you do, return the *original* `expires_at`, never a recomputed
   one.

### 2.5 Client behavior you can rely on

- Garage memory-caches per substituted URL until `expires_at − 5 min`
  (50 min when absent). Expect roughly one request per repo per ~55 min per
  *live* workload, plus a burst at template-provision time.
- The same endpoint is hit by `glorp __git-cred` (git credential helper) from
  inside agent workspaces — same headers, same shape, but a **fresh process
  each time**: helper invocations do not share Garage's cache. If that rate
  ever matters, serve cached tokens (§2.4.5).
- Tokens appear in exactly two places client-side: an in-memory cache and a
  `GIT_CONFIG_VALUE_0` env var on a child `git` process. Both the token and
  the derived auth header are scrubbed from any error Garage surfaces.

## 3. Capability: template registry

The service hosts Template v2 documents. Garage merges them with the
operator's on-disk templates — **disk wins on name collision** (the operator's
machine is authoritative over the network).

### 3.1 Endpoints

```
GET /v1/templates                 → { "templates": [ <Template>, … ] }
GET /v1/templates/{name}          → { "template": <Template> }
```

The operator configures Garage with the base URL (the `/v1/templates` form);
Garage appends `/{name}` (URL-encoded) for single fetches.

- `{name}`: match exactly; `404` (standard error body) when unknown.
- The list endpoint returns **full documents**, not summaries — Garage builds
  its own summaries and needs the whole document at provision time anyway.
  Keep libraries to a size where this stays cheap (hundreds, not millions).

### 3.2 Caching

- Support `ETag` on both endpoints and honor `If-None-Match` with `304` (no
  body). Garage sends `If-None-match` whenever it has a cached document and
  re-validates the list at most every 60 s, single fetches on demand.
- On any error (including timeouts), Garage serves its **last known good**
  copy of your templates. Don't rely on a failing registry to "pull" a
  template out of circulation quickly — delete it and let the next
  revalidation drop it.

### 3.3 The Template v2 document

```jsonc
{
  "name": "api-service",                      // REQUIRED, unique, [a-z0-9-]
  "description": "API service workspace",
  "params": [                                  // declared inputs
    { "name": "SERVICE_NAME", "description": "Human name",
      "required": true,                        // no default ⇒ caller must supply
      "default": "free",                       // applied when omitted
      "secret": false }                        // true ⇒ clients mask input; value is
  ],                                           //   scrubbed from every error message
  "repos": [                                   // cloned FIRST
    { "url": "https://github.com/acme/api",    // interpolatable
      "ref": "main",                           // optional branch/tag
      "dest": "app",                           // optional, default = repo basename;
                                               //   must resolve inside the workspace
      "auth": "github" }                       // routes through §2; default "none"
  ],
  "steps": [                                   // v1 surface, runs after repos
    { "type": "shell",     "command": "bun install" },
    { "type": "git-clone", "repo": "…", "dest": "…", "ref": "…" },
    { "type": "copy",      "from": "…", "to": "…" }
  ],
  "skills": [                                  // installed to <ws>/.claude/skills/<name>/
    { "name": "house-style",                   // inline form
      "description": "Code style",
      "content": "Use two-space indent." },    // front-matter synthesized if absent
    { "name": "deploy-runbook",                // RESOLVED form — registry templates
      "files": [                               //   must use inline or resolved; the
        { "path": "SKILL.md", "content": "---\nname: deploy-runbook\n…" },
        { "path": "checklist.md", "content": "…" }
      ] }                                      // `path` is relative, confined to the
  ],                                           //   skill folder; SKILL.md required
  "system_prompt": "You maintain {param:SERVICE_NAME}.",  // → <ws>/GLORP.md
  "mcp": [                                     // provisioned LAST
    { "provider": "linear", "url": "https://mcp.linear.app/mcp",
      "identities": [ { "name": "default",
        "headers": { "authorization": "Bearer {param:LINEAR_KEY}" } } ] }
  ],
  "deliverable": {                             // OPTIONAL — what a task MUST yield
    "required": true,                          // task never "completed" until satisfied
    "extensions": ["mp4"],                     // accepted file types (dot optional)
    "minCount": 1,                             // default 1 when required
    "verify": {                                // OPTIONAL integrity check, run in uploads/
      "command": "ffprobe -v error -show_entries stream=codec_type -of csv=p=0 {file} | grep -q video",
      "timeoutMs": 30000 },                    // {file} = the deliverable's absolute path
    "description": "a single playable .mp4 video"  // shown to the worker + clients
  }
}
```

Semantics the server must respect when authoring/generating documents:

- **Execution order** is fixed: params → repos → steps → skills →
  system_prompt → mcp.
- **Interpolation**: any string value may contain `{param:NAME}` (from the
  create request, validated against `params`) or `{env:VAR}` (from the
  *Garage host's* environment — useful for operator-owned secrets that should
  never transit your service). Unknown references fail the provision.
- **`from`-style skills do not work from the registry.** The disk form
  (`{"from": "skills/x"}`) resolves against the Garage operator's local
  template library and is meaningless coming from you. The registry MUST
  resolve its own library server-side and emit the `files` form. (This is
  deliberate: it keeps Garage's client one GET — no asset fetching, no
  tarballs — and gives you total freedom in how you store skills.)
- `system_prompt` lands as `GLORP.md`; if a cloned repo already ships one,
  Garage writes `GLORP.override.md` instead (which takes precedence), so your
  prompt always applies without destroying the repo's file.
- **`deliverable`** declares the artifact a task of this type must produce. It
  is the deterministic definition of "done": the worker's `deliver_result` call
  is REJECTED (with a specific reason the agent must fix) when a declared file
  is missing, the wrong type, too few, or fails `verify` — and a task with a
  `required` deliverable can never project as `completed` on a text reply alone.
  Omit it for text-only task types (research / Q&A). `verify` is best-effort: a
  non-zero exit rejects the file, but a missing toolchain (exit 127 / no `bash`)
  is treated as "could not verify here" and does not reject a structurally-valid
  artifact — so write piped verify commands to `set -o pipefail` if you rely on
  the missing-toolchain distinction. Malformed `deliverable` fields are dropped
  field-by-field, never failing the whole template.
- Validation failures (missing required params, path escapes, unknown
  `{param:…}`) surface to the API caller with secret values redacted.

### 3.4 What Garage does with them

- `GET /templates` (Garage's own API) lists disk + registry templates merged
  (disk shadows registry on equal `name`).
- Provisioning (`POST /workspaces` / `POST /sessions` with `template`)
  re-validates against the registry copy fetched at most 60 s ago.
- MCP agents see them too (`glorp_list_templates` / `glorp_create_workspace`)
  — assume templates are machine-consumed; keep `description` and param
  `description`s meaningful, they are the prompt surface.

## 4. Errors

Every non-200 carries:

```json
{ "error": "not_found", "message": "No installation for acme/widgets" }
```

`error` is a stable machine-readable slug; `message` is human-readable and
may be shown verbatim in the Garage dashboard. Never put tokens, key
material, or stack traces in either.

## 5. Conformance

**A full reference implementation ships in this repo: `glorp companion`**
(`src/companion/`). It implements both capabilities — GitHub App minting
(§2.4, given `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY[_FILE]`) and the
template registry with server-side skill resolution (§3) — and runs as the
fourth service inside the all-in-one Docker image, where Garage is wired to
it automatically. A hosted implementation should be drop-in
indistinguishable from it; its test suite (`tests/companion-service.test.ts`,
which verifies down to the JWT signature) doubles as your acceptance bar,
alongside the lighter stub at `tests/companion-stub.ts`. Smoke transcript:

```bash
# token, repo-scoped
curl -s -H 'authorization: Bearer K' \
  'https://svc/v1/git/token?repo=acme%2Fwidgets'
# → 200 {"token":"ghs_…","expires_at":"2026-06-11T09:30:00Z"}

# templates
curl -s -H 'authorization: Bearer K' https://svc/v1/templates
# → 200 {"templates":[{ "name": "api-service", … }]}  + ETag: "abc123"
curl -s -H 'authorization: Bearer K' -H 'if-none-match: "abc123"' \
  https://svc/v1/templates
# → 304 (empty body)
curl -s -H 'authorization: Bearer K' https://svc/v1/templates/nope
# → 404 {"error":"not_found","message":"…"}
```

Garage-side configuration for the integration, for reference:

```bash
GLORP_GARAGE_GIT_TOKEN_URL='https://svc/v1/git/token?repo={repo}'
GLORP_GARAGE_GIT_TOKEN_HEADERS='{"authorization":"Bearer K"}'
GLORP_GARAGE_TEMPLATE_REGISTRY_URL='https://svc/v1/templates'
GLORP_GARAGE_TEMPLATE_REGISTRY_HEADERS='{"authorization":"Bearer K"}'
```

(or `gitTokenUrl` / `gitTokenHeaders` / `templateRegistryUrl` /
`templateRegistryHeaders` in `~/.glorp/garage.json`.)
