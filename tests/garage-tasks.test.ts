/**
 * Task API units: the TaskStore, the status projection, the question/answer
 * mapping, the agent task-sink, and the completion-callback notifier — all
 * without an LLM. The booted-route + happy-path coverage lives in
 * garage-tasks-routes.test.ts (no model) and garage-task-e2e.test.ts (gated).
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TaskStore } from "../src/garage/task-store.ts";
import { loadGarageConfig } from "../src/garage/config.ts";
import { projectStatus, toQuestion, buildTaskDto } from "../src/garage/routes/task-project.ts";
import { SessionManager } from "../src/garage/manager.ts";
import { GlorpStore } from "../src/agent/store.ts";
import { coerceAnswer, validCallbackUrl } from "../src/garage/routes/tasks.ts";
import { createTaskSink, readDeliveredResult, readProgressNote } from "../src/agent/task-sink.ts";
import { validateDeliverable } from "../src/agent/task-deliverable.ts";
import { attachTaskNotifier } from "../src/garage/task-notifier.ts";
import { Bridge } from "../src/shared/bridge.ts";
import type { DisplaySlotEvent } from "../src/shared/events.ts";
import type { GarageSession } from "../src/garage/session.ts";

const tmpDirs: string[] = [];
function tmp(prefix = "tasks-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const base = {
  provisionError: null as string | null | undefined,
  hasSession: true,
  ageMs: 0,
  sessionError: null as string | null,
  openQuestionCount: 0,
  busy: false,
  lastError: null as string | null,
  turnCount: 0,
  hasOutput: false,
  startPending: false,
  requiresDeliverable: false,
  deliverableSatisfied: false,
};

describe("TaskStore", () => {
  it("creates, lists newest-first, and persists across reload", () => {
    const dir = tmp();
    const s = new TaskStore(dir);
    s.create({ id: "a", type: "x", created_at: "2026-01-01T00:00:00.000Z" });
    s.create({ id: "b", type: "y", created_at: "2026-01-02T00:00:00.000Z" });
    expect(s.list().map((r) => r.id)).toEqual(["b", "a"]);
    expect(new TaskStore(dir).get("a")?.type).toBe("x");
  });

  it("records a provision error and deletes", () => {
    const s = new TaskStore(tmp());
    s.create({ id: "a", type: "x", created_at: "2026-01-01T00:00:00.000Z" });
    s.setProvisionError("a", "boom");
    expect(s.get("a")?.provision_error).toBe("boom");
    expect(s.delete("a")).toBe(true);
    expect(s.get("a")).toBeUndefined();
  });
});

describe("projectStatus", () => {
  it("provision error → failed regardless of session", () => {
    expect(projectStatus({ ...base, provisionError: "x" })).toBe("failed");
  });
  it("no session → queued, or failed past the grace window", () => {
    expect(projectStatus({ ...base, hasSession: false, ageMs: 1000 })).toBe("queued");
    expect(projectStatus({ ...base, hasSession: false, ageMs: 11 * 60 * 1000 })).toBe("failed");
  });
  it("session error → failed", () => {
    expect(projectStatus({ ...base, sessionError: "wedged" })).toBe("failed");
  });
  it("an open question wins over busy (needs_input precedence)", () => {
    expect(projectStatus({ ...base, openQuestionCount: 1, busy: true })).toBe("needs_input");
  });
  it("busy with no question → working", () => {
    expect(projectStatus({ ...base, busy: true })).toBe("working");
  });
  it("a failed last turn → failed", () => {
    expect(projectStatus({ ...base, lastError: "model 400", turnCount: 1 })).toBe("failed");
  });
  it("output present and idle → completed (works for a dormant session)", () => {
    expect(projectStatus({ ...base, hasOutput: true })).toBe("completed");
  });
  it("session exists but no output yet → working (first turn in flight)", () => {
    expect(projectStatus({ ...base })).toBe("working");
  });
  it("a required-deliverable task is NOT completed on text alone → working", () => {
    // The core fix: chatter (hasOutput) must not complete a task that owes an artifact.
    expect(projectStatus({ ...base, requiresDeliverable: true, deliverableSatisfied: false, hasOutput: true })).toBe("working");
  });
  it("a required-deliverable task with a satisfying artifact → completed", () => {
    expect(projectStatus({ ...base, requiresDeliverable: true, deliverableSatisfied: true })).toBe("completed");
  });
  it("a required-deliverable failure (failed turn) still → failed", () => {
    expect(projectStatus({ ...base, requiresDeliverable: true, lastError: "boom", turnCount: 1 })).toBe("failed");
  });
  it("provisioned but holding the first turn (defer_start) → staged", () => {
    expect(projectStatus({ ...base, startPending: true })).toBe("staged");
    // staged wins over a busy/output projection (the turn hasn't run)…
    expect(projectStatus({ ...base, startPending: true, busy: true, hasOutput: true })).toBe("staged");
    // …but provisioning/session failures and a missing session still win over it.
    expect(projectStatus({ ...base, startPending: true, provisionError: "x" })).toBe("failed");
    expect(projectStatus({ ...base, startPending: true, sessionError: "wedged" })).toBe("failed");
    expect(projectStatus({ ...base, startPending: true, hasSession: false, ageMs: 1000 })).toBe("queued");
  });
});

function slot(renderer: string, input: unknown): DisplaySlotEvent {
  return { slotId: "s1", renderer, input, createdAt: 0, isPermissionRequest: false };
}

describe("toQuestion", () => {
  it("maps a choice with options", () => {
    const q = toQuestion(slot("select_one", { question: "Pick", options: [{ label: "A", value: "a", description: "the a" }, { label: "B" }] }));
    expect(q.kind).toBe("choice");
    expect(q.prompt).toBe("Pick");
    expect(q.options).toEqual([{ label: "A", value: "a", description: "the a" }, { label: "B", value: "B" }]);
  });
  it("maps confirm, text (with hints), and info", () => {
    expect(toQuestion(slot("confirm", { message: "OK?" })).kind).toBe("confirm");
    const t = toQuestion(slot("text_input", { question: "Name?", placeholder: "e.g. Ada", initial: "x" }));
    expect(t).toMatchObject({ kind: "text", prompt: "Name?", placeholder: "e.g. Ada", initial: "x" });
    expect(toQuestion(slot("info", { message: "FYI" })).kind).toBe("info");
  });
});

describe("coerceAnswer", () => {
  it("confirm → boolean, info → null, text/choice → string", () => {
    expect(coerceAnswer("confirm", "yes")).toBe(true);
    expect(coerceAnswer("confirm", true)).toBe(true);
    expect(coerceAnswer("confirm", "no")).toBe(false);
    expect(coerceAnswer("info", "whatever")).toBe(null);
    expect(coerceAnswer("text_input", "hello")).toBe("hello");
    expect(coerceAnswer("select_one", 42)).toBe("42");
  });
});

describe("task sink", () => {
  it("copies an out-of-uploads deliverable in, and reads it back", async () => {
    const ws = tmp("ws-");
    fs.mkdirSync(path.join(ws, "output"), { recursive: true });
    fs.writeFileSync(path.join(ws, "output", "deck.pptx"), "binary");
    const resultFile = path.join(tmp(), "task-result.json");
    const progressFile = path.join(tmp(), "task-progress.json");
    const sink = createTaskSink({ resultFile, progressFile, workspace: ws, now: () => "2026-01-01T00:00:00.000Z" });

    const res = await sink.deliver({ summary: "the deck", files: ["output/deck.pptx"], data: { slides: 3 } });
    expect(res).toEqual({ ok: true, files: ["deck.pptx"] }); // normalized into uploads/
    expect(fs.existsSync(path.join(ws, "uploads", "deck.pptx"))).toBe(true);

    const read = readDeliveredResult(resultFile);
    expect(read).toMatchObject({ summary: "the deck", files: ["deck.pptx"], data: { slides: 3 } });
  });

  it("keeps an already-uploads file in place and records progress", async () => {
    const ws = tmp("ws-");
    fs.mkdirSync(path.join(ws, "uploads"), { recursive: true });
    fs.writeFileSync(path.join(ws, "uploads", "out.mp4"), "v");
    const resultFile = path.join(tmp(), "r.json");
    const progressFile = path.join(tmp(), "p.json");
    const sink = createTaskSink({ resultFile, progressFile, workspace: ws });
    expect(await sink.deliver({ summary: "done", files: ["uploads/out.mp4"] })).toEqual({ ok: true, files: ["out.mp4"] });
    sink.progress("rendering 50%");
    expect(readProgressNote(progressFile)?.message).toBe("rendering 50%");
  });

  it("rejects (and persists nothing for) a declared file that escapes the workspace", async () => {
    const ws = tmp("ws-");
    const resultFile = path.join(tmp(), "r.json");
    const sink = createTaskSink({ resultFile, progressFile: path.join(tmp(), "p.json"), workspace: ws });
    const res = await sink.deliver({ summary: "x", files: ["../../etc/passwd"] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.violations[0]?.code).toBe("missing_files");
    expect(readDeliveredResult(resultFile)).toBeNull(); // nothing written
  });

  it("refuses a symlink under the workspace that points outside it", async () => {
    const ws = tmp("ws-");
    const outside = tmp("outside-");
    fs.writeFileSync(path.join(outside, "secret.txt"), "classified");
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(ws, "link.txt"));
    const sink = createTaskSink({ resultFile: path.join(tmp(), "r.json"), progressFile: path.join(tmp(), "p.json"), workspace: ws });
    const res = await sink.deliver({ summary: "x", files: ["link.txt"] });
    expect(res.ok).toBe(false);
    expect(fs.existsSync(path.join(ws, "uploads", "secret.txt"))).toBe(false);
  });

  it("rejects a declared-but-missing file even with no contract (no silent drop)", async () => {
    const ws = tmp("ws-");
    fs.mkdirSync(path.join(ws, "uploads"), { recursive: true });
    fs.writeFileSync(path.join(ws, "uploads", "real.pdf"), "ok");
    const resultFile = path.join(tmp(), "r.json");
    const sink = createTaskSink({ resultFile, progressFile: path.join(tmp(), "p.json"), workspace: ws });
    const res = await sink.deliver({ summary: "x", files: ["uploads/real.pdf", "uploads/ghost.csv"] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.violations[0]?.message).toContain("ghost.csv");
    expect(readDeliveredResult(resultFile)).toBeNull();
  });
});

describe("task sink with a deliverable contract", () => {
  const mp4Contract = { required: true, extensions: ["mp4"], description: "a playable .mp4 video" };
  // Minimal bytes that pass the built-in structural sniff (ftyp box at offset 4).
  const mp4Bytes = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom-minimal")]);

  function sinkFor(ws: string, resultFile: string) {
    return createTaskSink({
      resultFile, progressFile: path.join(tmp(), "p.json"), workspace: ws, deliverable: mp4Contract,
    });
  }

  it("accepts and persists a contract-matching artifact", async () => {
    const ws = tmp("ws-");
    fs.mkdirSync(path.join(ws, "uploads"), { recursive: true });
    fs.writeFileSync(path.join(ws, "uploads", "movie.mp4"), mp4Bytes);
    const resultFile = path.join(tmp(), "r.json");
    const res = await sinkFor(ws, resultFile).deliver({ summary: "the video", files: ["uploads/movie.mp4"] });
    expect(res).toEqual({ ok: true, files: ["movie.mp4"] });
    expect(readDeliveredResult(resultFile)?.files).toEqual(["movie.mp4"]);
  });

  it("rejects a JSON storyboard for a video task and writes nothing", async () => {
    const ws = tmp("ws-");
    fs.mkdirSync(path.join(ws, "uploads"), { recursive: true });
    fs.writeFileSync(path.join(ws, "uploads", "storyboard.json"), "{}");
    const resultFile = path.join(tmp(), "r.json");
    const res = await sinkFor(ws, resultFile).deliver({ summary: "here", files: ["uploads/storyboard.json"] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.violations.some((v) => v.code === "wrong_extension")).toBe(true);
    expect(readDeliveredResult(resultFile)).toBeNull();
  });

  it("rejects a corrupt 'mp4' (text bytes) with corrupt_file", async () => {
    const ws = tmp("ws-");
    fs.mkdirSync(path.join(ws, "uploads"), { recursive: true });
    fs.writeFileSync(path.join(ws, "uploads", "movie.mp4"), "just a storyboard in disguise");
    const resultFile = path.join(tmp(), "r.json");
    const res = await sinkFor(ws, resultFile).deliver({ summary: "the video", files: ["uploads/movie.mp4"] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.violations.map((v) => v.code)).toEqual(["corrupt_file"]);
    expect(readDeliveredResult(resultFile)).toBeNull();
  });

  it("rejects a deliver with no files when a deliverable is required", async () => {
    const ws = tmp("ws-");
    const resultFile = path.join(tmp(), "r.json");
    const res = await sinkFor(ws, resultFile).deliver({ summary: "all done!" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.violations[0]?.code).toBe("no_files");
    expect(readDeliveredResult(resultFile)).toBeNull();
  });
});

describe("validateDeliverable", () => {
  it("runs an opt-in verify command and rejects on non-zero exit", async () => {
    const root = tmp("up-");
    fs.writeFileSync(path.join(root, "a.mp4"), Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom-minimal")]));
    const v = await validateDeliverable({
      contract: { required: true, extensions: ["mp4"], verify: { command: "false" } },
      uploadsRoot: root, files: ["a.mp4"], missing: [],
    });
    expect(v.map((x) => x.code)).toEqual(["verify_failed"]);
  });

  it("passes a verify command that exits zero", async () => {
    const root = tmp("up-");
    fs.writeFileSync(path.join(root, "a.mp4"), Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom-minimal")]));
    const v = await validateDeliverable({
      contract: { required: true, extensions: ["mp4"], verify: { command: "test -f {file}" } },
      uploadsRoot: root, files: ["a.mp4"], missing: [],
    });
    expect(v).toEqual([]);
  });

  it("rejects an unopenable 'pdf' (no %PDF- header) with corrupt_file", async () => {
    const root = tmp("up-");
    fs.writeFileSync(path.join(root, "report.pdf"), "#!/usr/bin/env python\nprint('hi')\n");
    const v = await validateDeliverable({
      contract: { required: true, extensions: ["pdf"] },
      uploadsRoot: root, files: ["report.pdf"], missing: [],
    });
    expect(v.map((x) => x.code)).toEqual(["corrupt_file"]);
  });

  it("rejects a truncated pdf (missing %%EOF trailer)", async () => {
    const root = tmp("up-");
    fs.writeFileSync(path.join(root, "report.pdf"), "%PDF-1.7\nhalf a document");
    const v = await validateDeliverable({
      contract: { required: true, extensions: ["pdf"] },
      uploadsRoot: root, files: ["report.pdf"], missing: [],
    });
    expect(v.map((x) => x.code)).toEqual(["corrupt_file"]);
  });

  it("accepts a structurally sound pdf and office zip", async () => {
    const root = tmp("up-");
    fs.writeFileSync(path.join(root, "report.pdf"), "%PDF-1.7\ncontent\n%%EOF\n");
    fs.writeFileSync(path.join(root, "deck.pptx"), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]));
    const v = await validateDeliverable({
      contract: { required: true, extensions: ["pdf", "pptx"] },
      uploadsRoot: root, files: ["report.pdf", "deck.pptx"], missing: [],
    });
    expect(v).toEqual([]);
  });

  it("treats a missing verify toolchain as 'skipped', not a failure", async () => {
    const root = tmp("up-");
    fs.writeFileSync(path.join(root, "a.mp4"), Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom-minimal")]));
    const v = await validateDeliverable({
      contract: { required: true, extensions: ["mp4"], verify: { command: "definitely-not-a-real-binary-xyz {file}" } },
      uploadsRoot: root, files: ["a.mp4"], missing: [],
    });
    expect(v).toEqual([]); // structural checks stand; verify could not run
  });
});

describe("managed task params (config)", () => {
  it("reads GLORP_GARAGE_TASK_PARAM_<NAME> and skips a blank suffix", () => {
    const dir = tmp();
    process.env.GLORP_GARAGE_TASK_PARAM_RENDERER_KEY = "sk-1";
    process.env["GLORP_GARAGE_TASK_PARAM_"] = "orphan"; // empty name — must be skipped
    try {
      const cfg = loadGarageConfig({ dataDir: dir });
      expect(cfg.taskParams).toEqual({ RENDERER_KEY: "sk-1" });
      expect(cfg.taskParams && "" in cfg.taskParams).toBe(false);
    } finally {
      delete process.env.GLORP_GARAGE_TASK_PARAM_RENDERER_KEY;
      delete process.env["GLORP_GARAGE_TASK_PARAM_"];
    }
  });
});

describe("validCallbackUrl", () => {
  it("accepts http(s), normalizes, and rejects other schemes", () => {
    expect(validCallbackUrl("https://you.example/hook")).toBe("https://you.example/hook");
    expect(validCallbackUrl("http://svc.internal:3009/cb")).toBe("http://svc.internal:3009/cb");
    expect(validCallbackUrl(undefined)).toBeUndefined();
    expect(validCallbackUrl("")).toBeUndefined();
    expect(validCallbackUrl("file:///etc/passwd")).toBeNull();
    expect(validCallbackUrl("gopher://x")).toBeNull();
    expect(validCallbackUrl("not a url")).toBeNull();
    expect(validCallbackUrl(42)).toBeNull();
  });
});

describe("task usage meter (projection)", () => {
  it("reports cumulative tokens + cost that survive a compaction", async () => {
    const dataDir = tmp();
    const workspace = tmp("ws-");
    const id = "task-usage-1";

    // Seed a dormant worker session: priced usage, then a compaction. The
    // window counters reset, but the SESSION-cumulative totals + per-model
    // ledger persist — which is exactly what the meter must report.
    const store = new GlorpStore(id, dataDir, { workspace });
    store.setActiveModel({ providerId: "anthropic", model: "opus", label: "anthropic · opus", cost: { input: 3, output: 15 } });
    await store.addTokens({ tokens_in: 1_000_000, tokens_out: 1_000_000 }); // → $18
    await store.resetCounters(); // glove-core compaction zeroes the window gauge
    await store.flush();

    const config = loadGarageConfig({ dataDir, port: 0, hostname: "127.0.0.1", workspaceRoot: path.join(dataDir, "ws") });
    const manager = new SessionManager(config);
    const session = manager.getOrRehydrate(id);
    expect(session).toBeTruthy();

    const record = { id, type: "x", created_at: "2026-01-01T00:00:00.000Z" };
    const dto = await buildTaskDto(record, session, config, Date.now());

    // Cumulative — NOT the post-compaction window (which is 0).
    expect(dto.usage.tokens_in).toBe(1_000_000);
    expect(dto.usage.tokens_out).toBe(1_000_000);
    expect(dto.usage.tokens_total).toBe(2_000_000);
    expect(dto.usage.cost_usd).toBeCloseTo(18, 4);
    expect(dto.usage.cost_known).toBe(true);
  });

  it("reports a zeroed, well-formed meter for a task with no session yet", async () => {
    const config = loadGarageConfig({ dataDir: tmp(), port: 0, hostname: "127.0.0.1" });
    const record = { id: "queued-1", type: "x", created_at: "2026-01-01T00:00:00.000Z" };
    const dto = await buildTaskDto(record, undefined, config, Date.now());
    expect(dto.usage).toEqual({ tokens_in: 0, tokens_out: 0, tokens_total: 0, cost_usd: 0, cost_known: true });
  });
});

describe("task notifier", () => {
  it("fires on needs_input then completed, deduped, and tolerates a dead host", async () => {
    const statuses = ["working", "needs_input", "needs_input", "working", "completed"];
    let i = 0;
    const buildDto = async () => ({ id: "t", type: "x", status: statuses[Math.min(i++, statuses.length - 1)], title: null, result: { summary: null, text: null, files: [] }, questions: [], progress: null, error: null, created_at: "", updated_at: "" }) as any;

    const posted: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_url: any, init: any) => {
      posted.push((JSON.parse(String(init.body)) as { status: string }).status);
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const bridge = new Bridge();
    const session = { bridge } as unknown as GarageSession;
    try {
      attachTaskNotifier(session, buildDto, "http://sink.local/hook");
      // working (no fire), needs_input (fire), needs_input again (dedupe), working (reset), completed (fire)
      for (let n = 0; n < 5; n++) {
        bridge.emit({ type: "busy", busy: false });
        await Promise.resolve(); // let each maybeFire settle before the next event
      }
      const deadline = Date.now() + 2000;
      while (posted.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
    } finally {
      globalThis.fetch = orig;
    }
    expect(posted).toEqual(["needs_input", "completed"]);
  });
});
