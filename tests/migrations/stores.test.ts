/**
 * Store-level migration: session + roster migrators, lazy upgrade through
 * GlorpStore on load, and the eager migrateAllSessions batch pass.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { sessionMigrator, CURRENT_SESSION_VERSION } from "../../src/agent/migrations/session-store.ts";
import { rosterMigrator } from "../../src/agent/migrations/roster.ts";
import { migrateAllSessions } from "../../src/agent/migrations/migrate-all.ts";
import { GlorpStore } from "../../src/agent/store.ts";

let dataDir: string;
beforeEach(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-mig-")); });
afterEach(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} });

function write(file: string, obj: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj), "utf-8");
}

describe("session snapshot migrator", () => {
  test("normalizes a legacy unversioned snapshot and stamps the version", () => {
    const out = sessionMigrator.migrate({ messages: [{ sender: "user", text: "hi" }], title: "t" });
    expect(out.fromVersion).toBe(0);
    expect(out.data.version).toBe(CURRENT_SESSION_VERSION);
    expect(out.data.metadata?.kind).toBe("session");
    expect(out.data.messages).toHaveLength(1);
    expect(out.data.tasks).toEqual([]);
    expect(out.data.permissions).toEqual({});
    expect(out.data.tokensIn).toBe(0);
  });

  test("a current snapshot is left unchanged", () => {
    const current = { version: CURRENT_SESSION_VERSION, messages: [], tasks: [{ id: "1" }], metadata: { kind: "session", createdAt: "x" } };
    const out = sessionMigrator.migrate(current);
    expect(out.applied).toHaveLength(0);
    expect(out.data.tasks).toEqual([{ id: "1" } as any]);
  });
});

describe("roster migrator", () => {
  test("normalizes a legacy roster and stamps the version", () => {
    const out = rosterMigrator.migrate({ activeId: "main", specs: [{ id: "main", storeId: "s", role: "general" }] });
    expect(out.data.version).toBe(rosterMigrator.currentVersion);
    expect(out.data.specs).toHaveLength(1);
  });
});

describe("GlorpStore lazy migration on load", () => {
  test("upgrades a legacy snapshot and persists the new shape on flush", async () => {
    const file = path.join(dataDir, "sessions", "legacy", "session.json");
    write(file, { messages: [{ sender: "user", text: "hello" }], title: "t" }); // no version, missing fields

    const store = new GlorpStore("legacy", dataDir, { filePath: file });
    const msgs = await store.getDisplayMessages();
    expect(msgs[0]!.text).toBe("hello");          // data preserved
    await store.flush();                           // migration marked dirty → persisted

    const persisted = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(persisted.version).toBe(CURRENT_SESSION_VERSION);
    expect(persisted.metadata.kind).toBe("session");
  });
});

describe("migrateAllSessions (batch)", () => {
  test("upgrades sessions + rosters across layouts and skips unowned files", async () => {
    const S = path.join(dataDir, "sessions");
    write(path.join(S, "flat.json"), { messages: [{ sender: "user", text: "a" }] });           // legacy session
    write(path.join(S, "folder", "session.json"), { messages: [] });                            // folder session
    write(path.join(S, "folder", "roster.json"), { activeId: "main", specs: [{ id: "main", storeId: "x", role: "general" }] });
    write(path.join(S, "folder", "resources.json"), { dirs: [], files: [] });                   // unowned → skipped

    const report = await migrateAllSessions(dataDir);
    expect(report.migrated).toBe(3);    // 2 sessions + 1 roster
    expect(report.skipped).toBe(1);     // resources.json
    expect(report.errors).toBe(0);

    expect(JSON.parse(fs.readFileSync(path.join(S, "flat.json"), "utf-8")).version).toBe(CURRENT_SESSION_VERSION);
    expect(JSON.parse(fs.readFileSync(path.join(S, "folder", "session.json"), "utf-8")).version).toBe(CURRENT_SESSION_VERSION);
    expect(JSON.parse(fs.readFileSync(path.join(S, "folder", "roster.json"), "utf-8")).version).toBe(rosterMigrator.currentVersion);
    // unowned file untouched (no version field added)
    expect(JSON.parse(fs.readFileSync(path.join(S, "folder", "resources.json"), "utf-8")).version).toBeUndefined();

    // second pass is a no-op (everything already current)
    const again = await migrateAllSessions(dataDir);
    expect(again.migrated).toBe(0);
    expect(again.upToDate).toBe(3);
  });
});
