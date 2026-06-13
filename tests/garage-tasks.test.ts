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
import { projectStatus, toQuestion } from "../src/garage/routes/task-project.ts";
import { coerceAnswer, validCallbackUrl } from "../src/garage/routes/tasks.ts";
import { createTaskSink, readDeliveredResult, readProgressNote } from "../src/agent/task-sink.ts";
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
  it("copies an out-of-uploads deliverable in, and reads it back", () => {
    const ws = tmp("ws-");
    fs.mkdirSync(path.join(ws, "output"), { recursive: true });
    fs.writeFileSync(path.join(ws, "output", "deck.pptx"), "binary");
    const resultFile = path.join(tmp(), "task-result.json");
    const progressFile = path.join(tmp(), "task-progress.json");
    const sink = createTaskSink({ resultFile, progressFile, workspace: ws, now: () => "2026-01-01T00:00:00.000Z" });

    const { files } = sink.deliver({ summary: "the deck", files: ["output/deck.pptx"], data: { slides: 3 } });
    expect(files).toEqual(["deck.pptx"]); // normalized into uploads/
    expect(fs.existsSync(path.join(ws, "uploads", "deck.pptx"))).toBe(true);

    const read = readDeliveredResult(resultFile);
    expect(read).toMatchObject({ summary: "the deck", files: ["deck.pptx"], data: { slides: 3 } });
  });

  it("keeps an already-uploads file in place and records progress", () => {
    const ws = tmp("ws-");
    fs.mkdirSync(path.join(ws, "uploads"), { recursive: true });
    fs.writeFileSync(path.join(ws, "uploads", "out.mp4"), "v");
    const resultFile = path.join(tmp(), "r.json");
    const progressFile = path.join(tmp(), "p.json");
    const sink = createTaskSink({ resultFile, progressFile, workspace: ws });
    expect(sink.deliver({ summary: "done", files: ["uploads/out.mp4"] }).files).toEqual(["out.mp4"]);
    sink.progress("rendering 50%");
    expect(readProgressNote(progressFile)?.message).toBe("rendering 50%");
  });

  it("drops a declared file that escapes the workspace", () => {
    const ws = tmp("ws-");
    const sink = createTaskSink({ resultFile: path.join(tmp(), "r.json"), progressFile: path.join(tmp(), "p.json"), workspace: ws });
    expect(sink.deliver({ summary: "x", files: ["../../etc/passwd"] }).files).toEqual([]);
  });

  it("refuses a symlink under the workspace that points outside it", () => {
    const ws = tmp("ws-");
    const outside = tmp("outside-");
    fs.writeFileSync(path.join(outside, "secret.txt"), "classified");
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(ws, "link.txt"));
    const sink = createTaskSink({ resultFile: path.join(tmp(), "r.json"), progressFile: path.join(tmp(), "p.json"), workspace: ws });
    expect(sink.deliver({ summary: "x", files: ["link.txt"] }).files).toEqual([]);
    expect(fs.existsSync(path.join(ws, "uploads", "secret.txt"))).toBe(false);
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
