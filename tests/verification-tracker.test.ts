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

  test("a verification failure still clears the list (agent has the signal)", () => {
    const t = new VerificationTracker();
    t.observe("write", { path: "src/a.ts" }, { status: "success", data: "ok" });
    // A failed test run is still a verification — the agent now knows.
    // Status of the bash *call* doesn't really go "failed" for a normal
    // bash exit code; status is set when the harness rejects, which is
    // rare. We model verification as "the command ran and the agent saw
    // the result," so success in tool-call terms is correct.
    t.observe("bash", { command: "pytest" }, { status: "success", data: "1 failed" });
    expect(t.status().pendingFiles).toEqual([]);
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
      lastVerifiedAt: null,
      lastVerificationKind: null,
    });
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
      },
    });
    const injection = out.find((m) => m.is_skill_injection)!;
    expect(injection.text).toContain("Last verification observed: bun test");
    expect(injection.text).toContain("predates");
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
