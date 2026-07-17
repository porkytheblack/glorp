# Tasks — integrating the Garage Task API

This guide is for an **application integrating Garage as a black box**: you hand
it a job and get a result, without managing sessions, templates, display slots,
or the event stream. If you need that lower-level control, see
[garage-usage.md](./garage-usage.md); tasks are built on top of it and the two
can coexist.

- **A task is one object** with an `input` and a `result`. You submit it, then
  poll the same object (or receive a webhook) until it's `completed`/`failed`.
- **A task type is a template name.** The catalog is self-extending: a new
  capability is a new template on the server, with no change to your app.
- **The worker is task-aware.** It knows it's fulfilling a task, declares its
  deliverable explicitly, reports progress, and pauses to ask you a question
  only when it genuinely needs a decision.

## Install / connect

```bash
npm add @porkytheblack/glorp-client    # or: pnpm add / bun add
```

```ts
import { createClient } from "@porkytheblack/glorp-client";

const glorp = createClient({
  endpoint: process.env.GARAGE_URL!,    // https://garage.example.com
  apiKey: process.env.GARAGE_API_KEY!,  // glsk_…
  // namespace: "tenant-a",             // optional: act inside a tenant namespace
});
```

The base URL also resolves from `configure()` or the `GLORP_ENDPOINT` /
`GLORP_API_KEY` env vars; raw REST works too (`POST {endpoint}/api/v1/tasks`
with `Authorization: Bearer <key>`).

## The 10-line happy path

```ts
// 1. Submit. Returns immediately; the work runs in the background.
const { id } = await glorp.tasks.create({
  type: "slide-deck",
  input: { prompt: "A 5-slide deck on our Q3 results" },
});

// 2. Wait — polls to completion, answering any questions the agent asks.
const task = await glorp.tasks.wait(id, {
  onQuestion: (q) => (q.kind === "confirm" ? true : q.options?.[0]?.value ?? ""),
  onProgress: (note) => console.log("…", note),
});

// 3. Use the result.
if (task.status === "completed") {
  console.log(task.result.summary);                 // "5-slide deck on Q3 results"
  for (const f of task.result.files) {              // deliverables
    const bytes = await glorp.tasks.downloadFile(id, f.path);
    await fs.writeFile(f.path, bytes);
  }
} else {
  console.error("task failed:", task.error);
}
```

`tasks.wait()` is a thin convenience over `tasks.get()` polling — see
[Driving it yourself](#driving-it-yourself) if you'd rather own the loop (e.g.
a queue worker that persists between polls, or a webhook-driven flow).

## The task object

`GET /tasks/:id` (and `tasks.get(id)` / `tasks.wait(...)`) returns:

```jsonc
{
  "id": "task_…",
  "type": "slide-deck",
  "status": "completed",            // queued | staged | working | needs_input | completed | failed
  "title": "Q3 deck",               // a short auto-generated label, or null
  "result": {
    "summary": "5-slide deck on Q3 results",   // the agent's own description (or null)
    "text": "Done — deck.pptx has 5 slides …", // last agent message (fallback / extra context)
    "files": [ { "path": "deck.pptx", "size": 48211, "modified_at": "…" } ],
    "data": { "slides": 5 }          // optional structured fields the agent attached
  },
  "questions": [],                   // pending questions when status is needs_input (see below)
  "progress": "rendering slide 4/5", // latest non-blocking progress note, or null
  "error": null,                     // failure reason when status is failed
  "usage": {                         // cumulative token + cost meter (see Usage & cost)
    "tokens_in": 184320,
    "tokens_out": 12044,
    "tokens_total": 196364,
    "cost_usd": 0.7421,
    "cost_known": true
  },
  "created_at": "…",
  "updated_at": "…"
}
```

### Usage & cost (auditing / billing)

Every read of a task carries a `usage` meter, so an external system can audit
consumption and price it without a side channel:

| Field | Meaning |
| --- | --- |
| `tokens_in` | Cumulative input (prompt) tokens billed over the task's whole life |
| `tokens_out` | Cumulative output (completion) tokens |
| `tokens_total` | Convenience sum, `tokens_in + tokens_out` |
| `cost_usd` | Estimated USD from models.dev catalog **list pricing** |
| `cost_known` | `false` when any attributed model lacked a catalog price — treat `cost_usd` as a floor, not an exact bill |

The counts are **cumulative over the entire task** — they include every
follow-up message (`tasks.message`) and, crucially, survive **context
compaction**: the worker keeps a session-total counter that compaction never
resets, so a long, repeatedly-compacted task still reports its true lifetime
usage rather than just the current context window. The figure is monotonic — it
only ever grows — so you can poll it, diff against your last reading, and charge
the delta. It's present in every projection: `tasks.get`, `tasks.list`,
`tasks.wait` updates, and the webhook payload.

```ts
const task = await glorp.tasks.get(id);
console.log(task.usage.tokens_total, "tokens", `$${task.usage.cost_usd.toFixed(4)}`);
if (!task.usage.cost_known) console.warn("cost is a floor — an unpriced model was used");
```

### Status lifecycle

```
  ┌─(defer_start)─▶ staged ─(upload inputs, then start)─┐
queued                                                   ├─▶ working ──▶ completed
  └──────────────────(immediate)───────────────────────┘      │  ▲
                                                               ▼  │
                                                           needs_input ──(you answer)──┘

any state ──▶ failed
```

An immediate submit goes `queued → working`; a `defer_start` submit settles in
`staged` and waits for you to upload inputs and call `start` before it runs (see
[Attaching input files](#attaching-input-files)).

| Status | Meaning | What your app does |
| --- | --- | --- |
| `queued` | Accepted; workspace provisioning / first turn not started | wait |
| `staged` | Created with `defer_start`: provisioned, holding the first turn | upload inputs, then `start` (see [Attaching input files](#attaching-input-files)) |
| `working` | The agent is actively processing | wait (optionally surface `progress`) |
| `needs_input` | The agent asked a question and is blocked | answer `questions[*]` |
| `completed` | Finished; `result` holds the deliverable | read `result` |
| `failed` | Provisioning failed, the session errored, or the turn errored | read `error` |

`needs_input` takes precedence over `working`: when the agent is mid-turn but
waiting on you, the task reports `needs_input`.

**Deliverable contracts gate completion.** A task type whose template declares a
`required` deliverable (see the template `deliverable` field) never projects as
`completed` on a text reply alone — it stays `working` until the agent declares
a real artifact that satisfies the contract (right file type, exists, passes a
built-in structural check, passes the optional `verify` check). The built-in
check sniffs magic bytes per extension — a "pdf" without a `%PDF-` header or
`%%EOF` trailer, an office file that isn't a zip, or a text file named `.mp4`
is rejected as `corrupt_file` even when no `verify` command is configured. The
worker's `deliver_result` call is rejected, with a
specific reason, until then; this is what stops a "make a video" task from
handing back a JSON storyboard, an unopenable render, or finishing with no file. Such a task remains
`working` (its session kept alive) if the agent stops without producing the
artifact, so you can nudge it with a follow-up message — see
[Following up](#following-up-now-fix-x).

## Discovering task types

Each type is a template with typed inputs. List them to build a form or to
validate before submitting:

```ts
const { types } = await glorp.tasks.types();
// [{ name: "slide-deck", description: "…",
//    inputs: [{ name: "AUDIENCE", required: false, default: "general", secret: false }, …] }]
```

`inputs` are the template's params. Pass values in `input.params` at submit
time; mask `secret: true` ones in your UI. The `prompt` is always the free-text
instruction for the job.

**You never supply infrastructure secrets.** Things like a render service's key
or URL are *operator-managed* — set once on the Garage host — so they don't
appear in `inputs` and you don't pass them. `tasks.types()` shows exactly what
your app is responsible for and nothing more. (For example, the `remotion-video`
type takes just a `prompt`; its renderer key/URL are filled server-side.) See
[Operator: managed params](#operator-managed-params) if you run Garage.

## Submitting

```ts
const { id } = await glorp.tasks.create({
  type: "git-service",
  input: {
    prompt: "Fix the failing build and open a PR",
    params: { REPO_URL: "https://github.com/acme/api", BRANCH: "main" },
  },
  permission_mode: "bypass",            // default; agent never stops for tool-permission prompts
  callback_url: "https://you.example/glorp-hook",   // optional — see Webhooks
});
```

### Attaching input files

When the prompt needs to *reference* files the requester provides — a brief for a
deck, a dataset, assets for a video — create the task with **`defer_start`** so the
first turn is held until the files are in place. The files land in the task's
**`inputs/`** folder (the worker's read-only input area, kept separate from the
`uploads/` deliverables), and the prompt can name them directly.

```ts
// 1. Create deferred → the task provisions and settles in `staged`.
const { id } = await glorp.tasks.create({
  type: "slide-deck",
  input: { prompt: "Build an investor deck from brief.pdf and figures.csv" },
  defer_start: true,
});

// 2. Wait until `staged`, then upload each input into inputs/.
for (let t = await glorp.tasks.get(id); t.status === "queued"; t = await glorp.tasks.get(id)) {}
await glorp.tasks.uploadInput(id, new Blob([pdfBytes]), "brief.pdf");
await glorp.tasks.uploadInput(id, new Blob([csvBytes]), "figures.csv");

// 3. Start — the held prompt now runs with the files present.
await glorp.tasks.start(id);
const deck = await glorp.tasks.wait(id);
```

`tasks.createWithInputs(input, files)` does all three steps for you:

```ts
const { id } = await glorp.tasks.createWithInputs(
  { type: "slide-deck", input: { prompt: "Investor deck from brief.pdf" } },
  [{ blob: new Blob([pdfBytes]), name: "brief.pdf" }],
);
const deck = await glorp.tasks.wait(id);
```

Files **already in the workspace** (seeded by the task template, or left by an
earlier turn) need no upload — the worker reads them directly; just refer to them
by path in the prompt.

You can still drop files into `uploads/` after a task is running (e.g. mid-iteration)
with `tasks.uploadFile(id, …)`; those share the deliverable folder.

## Answering questions

When `status` is `needs_input`, `questions` holds what the agent is blocked on:

```jsonc
{ "id": "<slotId>", "kind": "choice",          // choice | confirm | text | info
  "prompt": "Which tone for the deck?",
  "options": [ { "label": "Formal", "value": "formal" }, { "label": "Playful", "value": "playful" } ] }
```

Answer by `question_id`; the type of `answer` depends on `kind`:

| kind | answer | UI |
| --- | --- | --- |
| `choice` | the chosen option's `value` (string) — or any free-text string | a picker (free text also accepted) |
| `confirm` | `true` / `false` | yes/no |
| `text` | a string (honors `placeholder` / `initial`) | a text field |
| `info` | `null` (just acknowledge) | an OK button |

```ts
await glorp.tasks.answer(id, question.id, "formal");
// the task returns to `working` and continues
```

`tasks.wait({ onQuestion })` does this for you; answer interactively when you
own the loop.

## Following up ("now fix X")

A task keeps its workspace and context, so you can iterate without resubmitting:

```ts
await glorp.tasks.message(id, "Make the title slide darker and re-render");
const updated = await glorp.tasks.wait(id);   // back to working → completed
```

The agent re-runs and calls `deliver_result` again, replacing the prior result.

## Getting deliverables

```ts
const { files } = await glorp.tasks.files(id);                 // list
const bytes = await glorp.tasks.downloadFile(id, "deck.pptx"); // Uint8Array
await glorp.tasks.deleteFile(id, "scratch.tmp");               // optional cleanup
```

Files live in the task's `uploads/` folder (mirrored to R2 if the operator
configured it). `result.files` is the authoritative deliverable list.

## Webhooks (skip polling)

Pass a `callback_url` at submit time and Garage POSTs the **full task object**
to it on every transition into `needs_input`, `completed`, or `failed`:

```ts
// POST https://you.example/glorp-hook
// body: the same shape as GET /tasks/:id
app.post("/glorp-hook", async (req, res) => {
  res.sendStatus(202);                     // ack fast
  const task = req.body;
  if (task.status === "needs_input") await answerSomehow(task);
  else if (task.status === "completed") await collect(task);
  else if (task.status === "failed") await alert(task);
});
```

Delivery is fire-and-forget with a 5s timeout and is **not retried**, so treat
it as a fast-path nudge and keep `tasks.get()` as the source of truth (e.g.
reconcile on a timer for any task you haven't seen finish). `callback_url` must
be `http(s)`; the request is made from the Garage host, so an internal URL
(e.g. on your private network) is fine and common.

## Driving it yourself

`tasks.wait()` is just this loop — own it when you need to persist between polls
or react to each update:

```ts
async function pollOnce(id: string) {
  const task = await glorp.tasks.get(id);
  switch (task.status) {
    case "needs_input":
      for (const q of task.questions) await glorp.tasks.answer(id, q.id, decide(q));
      return "continue";
    case "completed":
    case "failed":
      return task;            // terminal
    default:
      return "continue";      // queued | working
  }
}
```

Status is projected live on every read, so polling is cheap and safe to do from
multiple workers; a task is never lost across a restart (it rehydrates on next
access).

## Cancelling

```ts
await glorp.tasks.delete(id);   // aborts the run, removes the session + workspace
```

## Recipes

```ts
// Create a video, then iterate
const v = await glorp.tasks.create({ type: "remotion-video",
  input: { prompt: "15s product teaser, upbeat", params: { OUTPUT_PRESET: "social-vertical" } } });
await glorp.tasks.wait(v.id);
await glorp.tasks.message(v.id, "make the logo bigger in the last 3 seconds");
const final = await glorp.tasks.wait(v.id);

// Build a slide deck from a brief (files referenced by the prompt → inputs/)
const d = await glorp.tasks.createWithInputs(
  { type: "slide-deck", input: { prompt: "Investor update from brief.md" } },
  [{ blob: new Blob([brief]), name: "brief.md" }],
);
const deck = await glorp.tasks.wait(d.id, { onQuestion: (q) => q.options?.[0]?.value ?? "" });

// Fix a bug and open a PR
const b = await glorp.tasks.create({ type: "git-service",
  input: { prompt: "Users report a 500 on /checkout when the cart is empty — fix it and open a PR",
           params: { REPO_URL: "https://github.com/acme/api" } } });
const fixed = await glorp.tasks.wait(b.id);   // result.text / a PR link from the agent
```

> Three of these types ship as templates today (`remotion-video`, `slide-deck`,
> `git-service`). To add a type — e.g. `pr-review` — add a template to the
> companion's library; no Garage or app change is needed, and it appears in
> `tasks.types()` automatically.

## Operator: managed params

If you run the Garage host, set **managed params** so infrastructure inputs are
filled automatically and never have to be supplied (or even seen) by the apps
submitting tasks. Set them once:

```bash
# env on the Garage host — GLORP_GARAGE_TASK_PARAM_<NAME>=<value>
GLORP_GARAGE_TASK_PARAM_RENDERER_URL=http://remotion-renderer.railway.internal:3010
GLORP_GARAGE_TASK_PARAM_RENDERER_KEY=<the render service key>
```

(or a `taskParams` map in `garage.json`; env wins). They are **authoritative** —
applied to every task, overriding any value a submitter sends, so a tenant can't
point a task at its own infrastructure — and they are **removed from
`GET /tasks/types`**, so consumers only see the inputs they own. A template
param the operator manages no longer needs to be passed at submit time even if
the template declares it `required`.

### Prefilled, isolated environment variables

To hand a task **environment variables** the agent reads at runtime — whether
from a submitted param or an operator-managed one — declare a template `env` map.
Each value is interpolated (`{param:NAME}` / `{env:VAR}`) and exported into that
task's own workspace, cleanly isolated from every other task and never written
to the shared host environment:

```jsonc
{
  "params": [{ "name": "STRIPE_KEY", "required": true, "secret": true }],
  "env": { "STRIPE_KEY": "{param:STRIPE_KEY}", "RENDERER_URL": "{param:RENDERER_URL}" }
}
```

The submitting app just passes `params`; secrets are scrubbed from errors. See
[garage-usage.md → Runtime environment variables](./garage-usage.md#runtime-environment-variables-env).

## REST reference

All paths are under `/api/v1` (and the bare root), `Authorization: Bearer <key>`,
optional `X-Glorp-Namespace: <ns>`.

| Method | Path | Body / result |
| --- | --- | --- |
| `GET` | `/tasks/types` | `{ types: [{ name, description, inputs }] }` |
| `POST` | `/tasks` | `{ type, input:{ prompt, params? }, permission_mode?, callback_url?, defer_start? }` → 202 `{ id, type, status, created_at }` |
| `POST` | `/tasks/:id/start` | (no body) run a `defer_start` task's held turn → 202; 409 if already started / not deferred / still provisioning |
| `GET` | `/tasks` | `{ tasks: TaskDto[] }` |
| `GET` | `/tasks/:id` | `TaskDto` |
| `POST` | `/tasks/:id/messages` | `{ text }` → 202 |
| `POST` | `/tasks/:id/answers` | `{ question_id, answer }` |
| `POST` | `/tasks/:id/inputs` | multipart `file` → input file list (caller-provided inputs, in `inputs/`) |
| `GET` | `/tasks/:id/inputs[/:path]` | list / download inputs |
| `DELETE` | `/tasks/:id/inputs/:path` | delete one input |
| `POST` | `/tasks/:id/files` | multipart `file` → file list (deliverable exchange, in `uploads/`) |
| `GET` | `/tasks/:id/files[/:path]` | list / download |
| `DELETE` | `/tasks/:id/files/:path` | delete one file |
| `DELETE` | `/tasks/:id` | cancel + remove |
