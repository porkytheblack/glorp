# Station: per-namespace concurrency, idle GC & teardown

Operational reference for running Station with **one namespace per tenant** under
load — the concurrency model, the idle-session GC, teardown semantics, and what
does (and does not) wedge a namespace. Written as the answer to the recurring
"why does the second build in a tenant starve / why is the namespace stuck"
questions.

> TL;DR — Station itself imposes **no per-namespace session cap**. What starves a
> tenant is *accumulated loaded sessions* each pinning an agent host. The
> idle-session GC ([`station-usage.md`](./station-usage.md#session-lifecycle-idle-gc--teardown))
> reclaims them; `result.reason` lets you see when a slot wasn't really free.

---

## The unit of concurrency: the agent host

Each session lazily builds a `GlorpHandle` — a model adapter plus any sandbox
child processes the agent spawns. That handle is the **agent host**: the real,
finite resource. The REST layer (`SessionManager`) keeps an in-memory map of
sessions and has **no semaphore, mutex, or concurrency cap** — two sessions in
one namespace can be `busy` at the same time as far as Station is concerned.

So when a *second concurrent build in a namespace never starts*, it is not a
Station-level lock. The realistic causes, in order:

1. **Resource exhaustion in the namespace.** Idle-but-loaded sessions each hold
   an agent host (RAM, file handles, sandbox processes). Enough of them and the
   next build can't get a worker. This is the accumulation in the report
   (6 idle sessions piled up over a day) — and the thing the GC fixes.
2. **The model backend.** OpenRouter (and most providers) enforce per-key
   concurrency / rate limits. A namespace pinned to one key effectively serializes
   there. Raise the limit with the provider, or give the namespace its own key.
3. **The host the container runs in.** A single small container has its own CPU/
   memory ceiling shared across every namespace it hosts.

**There is no cap to "raise" inside Station.** If you need to *limit* a tenant,
do it at the model-key or container level; if builds starve, reclaim idle hosts
(below) and check the backend's concurrency limit.

---

## Idle-session GC (the fix for accumulation)

`SessionManager.reapIdle(ttl)` unloads any **loaded** session that is not busy,
has no connected WebSocket client, and has been idle past the TTL. Unloading
shuts the agent host down but **keeps the on-disk snapshot**, so the session goes
dormant and rehydrates on the next access. A background sweep
([`gc.ts`](../src/station/gc.ts)) runs this across every live namespace.

- **On by default**, TTL 30 min, sweep every 60 s.
- Tune via `idleSessionTtlMs` / `gcIntervalMs` in `station.json`, or
  `GLORP_STATION_IDLE_TTL_MS` / `GLORP_STATION_GC_INTERVAL_MS`. Set the TTL to
  `0` to disable.

This is the *preventative* for the persistent wedge: the wedge develops under
**churn** (many sessions created while a constrained slot is held). Stopping idle
hosts from piling up removes the pressure that produces it. Combine with the
client-side hygiene you're already doing (destroy the session at the end of every
terminal turn).

---

## Teardown & `destroy()` on a busy session

`destroy()` removes the session from `GET /sessions` **immediately** and, if a
turn is in flight, **aborts the running agent before shutting the handle down** —
a busy session is never silently left running and holding its slot
([`session.ts`](../src/station/session.ts) `destroy()`).

What Station controls ends at the agent host. If your deployment runs each
namespace/session inside a heavier sandbox (a container or a mounted volume that
a platform reclaims lazily), that reclamation latency (the ~150 s you measured)
is **downstream of Station** and not something the REST `destroy` can make
synchronous. Use `result.reason` (below) rather than absence-from-`list()` as the
signal that a session is actually gone, and prefer **reusing** a session over
back-to-back destroy+recreate when you can.

---

## `result.reason`: telling "wedged / no worker" from an empty turn

`GET /sessions/:id/result` now returns a `reason` so an orchestrator can
distinguish states that all otherwise look like `{ busy:false, text:null,
error:null }`:

| `reason` | What it means for your poller |
|---|---|
| `running` | keep polling |
| `ok` | done, `text` is the answer |
| `empty` | the agent ran a turn and **chose to write nothing** — a real (if unhelpful) result, not a starvation |
| `idle` | no turn has run yet — if you sent a prompt and it stays `idle`, a worker never engaged (starved / not built) |
| `provisioning` | template / handle still coming up |
| `error` | the session failed; surface `error` to the user |

A session that goes `busy` briefly then settles at `reason:"empty"` produced an
empty answer; one that you prompted but that sits at `reason:"idle"` with
`turn_count:0` never got a worker — that's the starvation signal to retry
elsewhere (or after a GC sweep) instead of reporting an empty deliverable.

---

## The persistent wedge: what survives a restart, and the lighter reset

The wedge is keyed to a namespace's **on-disk subtree**, not to in-memory state —
which is why a container restart doesn't clear it but `namespaces.delete(id, true)`
(which wipes the subtree) does. The per-namespace state on the volume is:

```text
<dataDir>/namespaces/<id>/
  sessions/            session + sub-agent snapshots (per-session)
  workspaces.json      first-class workspace registry
  credentials.json     the namespace's model-credential overlay
<workspaceRoot>/<id>/  the namespace's sandbox working directories
```

Per-session snapshots can't wedge *new* sessions (each new session is its own
file). The state shared by every new session in the namespace is the
**credentials overlay** and the **sandbox root** — a poisoned credential profile
or a sandbox working tree left in a bad state is the realistic persistent
culprit, and both live under the subtree that `?data=true` deletes.

**A lighter reset than deleting the namespace** (keeps the namespace record and
its API keys):

- Destroy the namespace's sessions (clears `sessions/`) —
  `DELETE /sessions/:id` per session, or cascade via the workspace.
- If the sandbox tree is the problem, delete the workspace dirs under
  `<workspaceRoot>/<id>/` and let sessions re-provision.
- Re-mint / re-point the namespace credential if a bad profile is the cause.

The GC makes this rarely necessary by keeping idle hosts from accumulating in the
first place.

---

## Recommended settings for unattended runs

- **`permissionMode`**: use `auto` for unattended builds (auto-approves safe ops,
  still escalates genuinely destructive/interactive ones). Use `bypass` only when
  you fully trust the workspace and want *zero* prompts — it approves everything.
- **One key per namespace** so a single tenant's backend rate limit can't
  serialize another's, and so a leaked key is scoped to one tenant.
- **Leave the GC on**; lower `idleSessionTtlMs` if your tenants are bursty and you
  want hosts reclaimed sooner.
