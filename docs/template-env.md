# Template `env` — runtime environment variables (integration guide)

For template authors (and coding agents) wiring **prefilled, per-task-isolated
environment variables** into a Garage task/session template. A template's `env`
map becomes environment variables the worker reads at runtime — the external
service submitting the task just passes values as `params`.

## TL;DR

```jsonc
{
  "name": "git-service",
  "repos": [{ "url": "https://github.com/{param:REPO}", "auth": "github" }],
  "params": [
    { "name": "REPO", "required": true },
    { "name": "SENTRY_DSN", "secret": true }
  ],
  "env": {
    "SENTRY_DSN": "{param:SENTRY_DSN}",
    "NODE_ENV": "production",
    "REGION": "{env:DEPLOY_REGION}"
  }
}
```

At runtime the agent sees `$SENTRY_DSN`, `$NODE_ENV`, `$REGION` in **every** `bash`
command — no `export` boilerplate, no shell step.

## Shape & rules

| Rule | Detail |
| --- | --- |
| Field | `env?: Record<string, string>` on the template (sibling of `params`, `repos`, `steps`, `mcp`). |
| Value interpolation | `{param:NAME}` (submitted or operator-managed params) and `{env:VAR}` (the Garage host env). Plain literals pass through unchanged. |
| Names | Must be valid shell identifiers — `^[A-Za-z_][A-Za-z0-9_]*$`. An invalid name fails provisioning with a clear error. |
| Quoting | Values are shell-quoted, so spaces, quotes, `$`, and `;` are written **literally** — no expansion, no command injection. |
| Minimal template | An `env`-only template is valid (it provisions something). |

## Under the hood

Each `NAME: value` is interpolated and appended as `export NAME='value'` to
`<workspace>/.glorp/gh-env.sh` — the script `BASH_ENV` sources before every bash
command. The `env` section runs **after** repo cloning, so it coexists with the
GitHub-auth bridge that shares that same file (it appends, never clobbers).

## Guarantees

- **Cleanly isolated** — the script lives in the task's own workspace
  (`workspaceRoot/<id>`, confined per namespace in tenant mode). The shared host
  `process.env` is never mutated, so one task's env can never leak into another's.
- **Secret-safe** — interpolated values are added to the engine's secrets set and
  scrubbed (`***`) from any error surfaced to the API caller; nothing interpolated
  is logged. Mark the backing param `secret: true` so clients mask it and it's
  redacted even before its first use.

## Gotchas

- **Runtime only.** Provisioning `shell` steps do *not* see `env` — they run
  without sourcing `BASH_ENV`. If a step itself needs a value, reference
  `{param:...}` inline in the step's `command`.
- **Re-sourced each command.** The file is sourced fresh before every bash call;
  a var you mutate inside one command doesn't carry over to the next.
- **Operator secrets the submitter shouldn't see.** Set
  `GLORP_GARAGE_TASK_PARAM_<NAME>` on the Garage host and reference `{param:NAME}`
  in `env` — managed params override anything the submitter sends and are hidden
  from `GET /tasks/types`. Host env vars can also be read directly via `{env:VAR}`.

## Submitting a task that uses it

The app supplies the params; the template maps them into `env`:

```ts
await glorp.tasks.create({
  type: "git-service",
  input: {
    prompt: "Fix the failing build and open a PR",
    params: { REPO: "acme/api", SENTRY_DSN: "https://examplePublicKey@o0.ingest.sentry.io/0" },
  },
});
```

`GET /templates` reports an `env_count` per template, so you can see at a glance
which templates set runtime env.

See also: [garage-usage.md → Setup templates](./garage-usage.md#setup-templates)
for the full template surface, and [tasks.md](./tasks.md) for the Task API.
