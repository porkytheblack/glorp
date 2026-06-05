import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  VerificationTracker,
  looksLikeVerification,
} from "../src/agent/runtime/verification-tracker.ts";
import { GlorpStore } from "../src/agent/store.ts";
import { withSessionState } from "../src/agent/session-state.ts";

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-verif-"));
});

afterEach(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

describe("looksLikeVerification", () => {
  test.each([
    ["bun test", true],
    ["bun test tests/foo.ts", true],
    ["npm test", true],
    ["pnpm run test", true],
    ["yarn test --watch", true],
    ["pytest", true],
    ["python -m pytest tests/", true],
    ["go test ./...", true],
    ["cargo test", true],
    ["bunx tsc --noEmit", true],
    ["npx tsc", true],
    ["tsc", true],
    ["bun lint", true],
    ["npm run build", true],
    ["cargo check", true],
    ["python scripts/office/validate.py doc.docx", true],
    ["bun run dev", false],
    ["ls -la", false],
    ["git status", false],
    ["echo hello", false],
    ["cat tsconfig.json", false],
    ["npm install docx", false],
    ["mkdir -p output", false],
  ])("'%s' → %s", (cmd, expected) => {
    expect(looksLikeVerification(cmd)).toBe(expected);
  });
});

describe("VerificationTracker.observe", () => {
  test("records mutations on successful write/edit/apply_patch", () => {
    const t = new VerificationTracker();
    t.observe("write", { path: "src/a.ts", content: "x" }, { status: "success", data: "Created" });
    t.observe("edit", { path: "src/b.ts", old_string: "x", new_string: "y" }, { status: "success", data: "ok" });
    t.observe("apply_patch", { file_path: "src/c.ts" }, { status: "success", data: "ok" });
    expect(t.status().pendingFiles).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  test("ignores failed mutations", () => {
    const t = new VerificationTracker();
    t.observe("write", { path: "src/a.ts" }, { status: "error", message: "boom" } as any);
    expect(t.status().pendingFiles).toEqual([]);
  });

  test("a verification bash clears pending mutations", () => {
    const t = new VerificationTracker();
    t.observe("write", { path: "src/a.ts" }, { status: "success", data: "ok" });
    t.observe("bash", { command: "bun test" }, { status: "success", data: "passed" });
    expect(t.status().pendingFiles).toEqual([]);
    expect(t.status().lastVerificationKind).toContain("test");
  });

  test("a failed verification keeps pending files AND records the failure", () => {
    const t = new VerificationTracker();
    t.observe("write", { path: "src/a.ts" }, { status: "success", data: "ok" });
    t.observe(
      "bash",
      { command: "python scripts/office/validate.py doc.docx" },
      { status: "error", data: null, message: "Command exited with code 1" } as any,
    );
    // Pending list is NOT cleared — the verification did not pass.
    expect(t.status().pendingFiles).toEqual(["src/a.ts"]);
    expect(t.status().failedVerifications).toHaveLength(1);
    expect(t.status().failedVerifications[0]?.kind).toContain("validate.py");
    expect(t.status().failedVerifications[0]?.message).toContain("code 1");
  });

  test("a subsequent successful verification clears both pending list and failure ring", () => {
    const t = new VerificationTracker();
    t.observe("write", { path: "src/a.ts" }, { status: "success", data: "ok" });
    t.observe(
      "bash",
      { command: "pytest tests/" },
      { status: "error", data: null, message: "1 failed" } as any,
    );
    expect(t.status().failedVerifications).toHaveLength(1);
    t.observe("bash", { command: "pytest tests/" }, { status: "success", data: "passed" });
    expect(t.status().pendingFiles).toEqual([]);
    expect(t.status().failedVerifications).toEqual([]);
  });

  test("ring of failed verifications is bounded to 5", () => {
    const t = new VerificationTracker();
    for (let i = 0; i < 9; i++) {
      t.observe(
        "bash",
        { command: `bun test attempt-${i}.ts` },
        { status: "error", data: null, message: `try ${i}` } as any,
      );
    }
    expect(t.status().failedVerifications).toHaveLength(5);
    // Oldest entries fall off the front.
    expect(t.status().failedVerifications[0]?.message).toBe("try 4");
    expect(t.status().failedVerifications[4]?.message).toBe("try 8");
  });

  test("onUserTurn() clears failed verifications (user has moved on)", () => {
    const t = new VerificationTracker();
    t.observe(
      "bash",
      { command: "bun test" },
      { status: "error", data: null, message: "failed" } as any,
    );
    expect(t.status().failedVerifications).toHaveLength(1);
    t.onUserTurn();
    expect(t.status().failedVerifications).toEqual([]);
  });

  test("non-verification bash leaves the list alone", () => {
    const t = new VerificationTracker();
    t.observe("write", { path: "src/a.ts" }, { status: "success", data: "ok" });
    t.observe("bash", { command: "ls -la" }, { status: "success", data: "ok" });
    expect(t.status().pendingFiles).toEqual(["src/a.ts"]);
  });

  test("write after verification re-pollutes the pending list", () => {
    const t = new VerificationTracker();
    t.observe("write", { path: "src/a.ts" }, { status: "success", data: "ok" });
    t.observe("bash", { command: "bun test" }, { status: "success", data: "passed" });
    t.observe("edit", { path: "src/a.ts", old_string: "x", new_string: "y" }, { status: "success", data: "ok" });
    expect(t.status().pendingFiles).toEqual(["src/a.ts"]);
  });

  test("reset() wipes everything", () => {
    const t = new VerificationTracker();
    t.observe("write", { path: "x.ts" }, { status: "success", data: "ok" });
    t.recordVerification("manual");
    t.reset();
    expect(t.status()).toEqual({
      pendingFiles: [],
      pendingDocs: [],
      lastVerifiedAt: null,
      lastVerificationKind: null,
      failedVerifications: [],
    });
  });
});

describe("VerificationTracker — document deliverables", () => {
  test("writing a document marks it pending as a doc", () => {
    const t = new VerificationTracker();
    t.observe("write", { path: "uploads/report.docx" }, { status: "success", data: "ok" });
    expect(t.status().pendingFiles).toEqual(["uploads/report.docx"]);
    expect(t.status().pendingDocs).toEqual(["uploads/report.docx"]);
  });

  test("source files are not classified as documents", () => {
    const t = new VerificationTracker();
    t.observe("write", { path: "src/app.ts" }, { status: "success", data: "ok" });
    expect(t.status().pendingDocs).toEqual([]);
  });

  test("re-reading a produced document clears it (self-review)", () => {
    const t = new VerificationTracker();
    t.observe("edit", { path: "deck.pptx", old_string: "a", new_string: "b" }, { status: "success", data: "ok" });
    expect(t.status().pendingDocs).toEqual(["deck.pptx"]);
    t.observe("read", { path: "deck.pptx" }, { status: "success", data: "..." });
    expect(t.status().pendingFiles).toEqual([]);
    expect(t.status().pendingDocs).toEqual([]);
  });

  test("reading an unrelated file does not clear a pending document", () => {
    const t = new VerificationTracker();
    t.observe("write", { path: "report.docx" }, { status: "success", data: "ok" });
    t.observe("read", { path: "src/other.ts" }, { status: "success", data: "..." });
    expect(t.status().pendingDocs).toEqual(["report.docx"]);
  });

  test("a reviewer subagent pass clears pending documents but not code", () => {
    const t = new VerificationTracker();
    t.observe("write", { path: "report.docx" }, { status: "success", data: "ok" });
    t.observe("write", { path: "src/app.ts" }, { status: "success", data: "ok" });
    t.observe("glove_invoke_subagent", { name: "reviewer" }, { status: "success", data: "punch list" });
    // Document cleared; source file still needs a real toolchain check.
    expect(t.status().pendingDocs).toEqual([]);
    expect(t.status().pendingFiles).toEqual(["src/app.ts"]);
  });

  test("spawning an evaluator clears pending documents", () => {
    const t = new VerificationTracker();
    t.observe("write", { path: "out/summary.pdf" }, { status: "success", data: "ok" });
    t.observe("spawn_agent", { role: "evaluator", task: "judge it" }, { status: "success", data: "ok" });
    expect(t.status().pendingDocs).toEqual([]);
    expect(t.status().pendingFiles).toEqual([]);
  });
});

describe("withSessionState — verification block", () => {
  test("no block when nothing is pending", () => {
    const out = withSessionState([{ sender: "user", text: "hi" }], {
      plan: null,
      tasks: [],
      inboxItems: [],
      verification: { pendingFiles: [], lastVerifiedAt: null, lastVerificationKind: null },
    });
    const injection = out.find((m) => m.is_skill_injection);
    expect(injection).toBeUndefined();
  });

  test("renders pending files inline with the session-state injection", () => {
    const out = withSessionState([{ sender: "user", text: "hi" }], {
      plan: null,
      tasks: [],
      inboxItems: [],
      verification: {
        pendingFiles: ["src/foo.ts", "src/bar.ts"],
        lastVerifiedAt: null,
        lastVerificationKind: null,
      },
    });
    const injection = out.find((m) => m.is_skill_injection && m.text.includes("Unverified mutations"));
    expect(injection).toBeDefined();
    expect(injection!.text).toContain("src/foo.ts");
    expect(injection!.text).toContain("src/bar.ts");
    expect(injection!.text).toContain("No verification command has run");
  });

  test("clips to 20 files with an overflow line", () => {
    const files = Array.from({ length: 35 }, (_, i) => `src/file${i}.ts`);
    const out = withSessionState([{ sender: "user", text: "hi" }], {
      plan: null,
      tasks: [],
      inboxItems: [],
      verification: { pendingFiles: files, lastVerifiedAt: null, lastVerificationKind: null },
    });
    const injection = out.find((m) => m.is_skill_injection)!;
    expect(injection.text).toContain("src/file0.ts");
    expect(injection.text).toContain("src/file19.ts");
    expect(injection.text).not.toContain("src/file20.ts");
    expect(injection.text).toContain("and 15 more");
  });

  test("notes when a stale verification predates current changes", () => {
    const out = withSessionState([{ sender: "user", text: "hi" }], {
      plan: null,
      tasks: [],
      inboxItems: [],
      verification: {
        pendingFiles: ["src/x.ts"],
        lastVerifiedAt: 1000,
        lastVerificationKind: "bun test",
        failedVerifications: [],
      },
    });
    const injection = out.find((m) => m.is_skill_injection)!;
    expect(injection.text).toContain("Last verification observed: bun test");
    expect(injection.text).toContain("predates");
  });

  test("renders the failed-verification block with the iterate-or-document language", () => {
    const out = withSessionState([{ sender: "user", text: "hi" }], {
      plan: null,
      tasks: [],
      inboxItems: [],
      verification: {
        pendingFiles: [],
        lastVerifiedAt: null,
        lastVerificationKind: null,
        failedVerifications: [
          { kind: "soffice.py", message: "Command exited with code 1", commandHead: "python scripts/office/soffice.py --headless --convert-to pdf x.docx", at: 1 },
        ],
      },
    });
    const injection = out.find((m) => m.is_skill_injection && m.text.includes("Failed verifications"))!;
    expect(injection).toBeDefined();
    expect(injection.text).toContain("soffice.py");
    expect(injection.text).toContain("Command exited with code 1");
    expect(injection.text).toContain("Plan → Implement → Verify → Iterate");
    expect(injection.text).toContain("environmental");
  });

  test("both pending mutations AND failed verifications render side-by-side", () => {
    const out = withSessionState([{ sender: "user", text: "hi" }], {
      plan: null,
      tasks: [],
      inboxItems: [],
      verification: {
        pendingFiles: ["src/a.ts"],
        lastVerifiedAt: null,
        lastVerificationKind: null,
        failedVerifications: [
          { kind: "bun test", message: "1 failed", commandHead: "bun test", at: 1 },
        ],
      },
    });
    const injection = out.find((m) => m.is_skill_injection)!;
    expect(injection.text).toContain("Unverified mutations");
    expect(injection.text).toContain("Failed verifications");
    expect(injection.text).toContain("src/a.ts");
    expect(injection.text).toContain("bun test");
  });
});

describe("GlorpStore.getMessages — verification injection end-to-end", () => {
  test("attached tracker surfaces pending files in the message list", async () => {
    const store = new GlorpStore("vt-1", dataDir, { workspace: dataDir });
    const tracker = new VerificationTracker();
    tracker.observe("write", { path: "src/feature.ts" }, { status: "success", data: "ok" });
    store.setVerificationTracker(tracker);
    await store.appendMessages([{ sender: "user", text: "build the feature" }]);

    const msgs = await store.getMessages();
    const injection = msgs.find((m) => m.is_skill_injection && m.text.includes("Unverified mutations"));
    expect(injection).toBeDefined();
    expect(injection!.text).toContain("src/feature.ts");
  });

  test("verification cleared by a subsequent test run drops the block", async () => {
    const store = new GlorpStore("vt-2", dataDir, { workspace: dataDir });
    const tracker = new VerificationTracker();
    tracker.observe("write", { path: "src/feature.ts" }, { status: "success", data: "ok" });
    tracker.observe("bash", { command: "bun test" }, { status: "success", data: "passed" });
    store.setVerificationTracker(tracker);
    await store.appendMessages([{ sender: "user", text: "build the feature" }]);

    const msgs = await store.getMessages();
    const verification = msgs.find((m) => m.is_skill_injection && m.text.includes("Unverified mutations"));
    expect(verification).toBeUndefined();
  });
});
