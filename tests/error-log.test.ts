/**
 * Per-session error log: unit coverage for the writer + console tee, plus an
 * integration check that bridge `error` events land in the session's log file.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SessionErrorLog, setActiveErrorLog } from "../src/agent/runtime/error-log.ts";
import { resolveSessionPaths } from "../src/agent/session-paths.ts";
import { buildGlorp } from "../src/agent/glorp.ts";
import { getBridge } from "../src/shared/bridge.ts";

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "sk-test";

let dataDir: string;
let workspace: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-errlog-data-"));
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-errlog-ws-"));
});
afterEach(() => {
  setActiveErrorLog(null);
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {}
});

describe("SessionErrorLog", () => {
  test("writes JSONL to the session's errors.log and reads it back", async () => {
    const errorsFile = resolveSessionPaths(dataDir, "sess-1").errorsFile;
    const log = new SessionErrorLog(errorsFile);
    expect(log.filePath).toBe(errorsFile);
    log.record({ source: "agent", message: "boom one", detail: "stack-a", agentId: "main" });
    log.record({ source: "orchestrator", message: "boom two" });
    await log.flush();

    const entries = await log.readRecent();
    expect(entries).toHaveLength(2);
    expect(entries[0]!.message).toBe("boom one");
    expect(entries[0]!.detail).toBe("stack-a");
    expect(entries[0]!.agentId).toBe("main");
    expect(typeof entries[0]!.ts).toBe("string");
    expect(entries[1]!.source).toBe("orchestrator");

    // raw file is valid JSON Lines
    const raw = fs.readFileSync(log.filePath, "utf-8").trim().split("\n");
    expect(raw).toHaveLength(2);
    expect(() => raw.map((l) => JSON.parse(l))).not.toThrow();
  });

  test("console.error is teed to the active log (with stacks) and stops when cleared", async () => {
    const log = new SessionErrorLog(resolveSessionPaths(dataDir, "sess-2").errorsFile);
    setActiveErrorLog(log);
    console.error("[unit] something failed:", new Error("kaboom"));
    await log.flush();
    let entries = await log.readRecent();
    expect(entries.some((e) => e.source === "console" && /something failed/.test(e.message))).toBe(true);
    expect(entries.some((e) => /kaboom/.test(e.message))).toBe(true); // stack captured

    setActiveErrorLog(null);
    console.error("[unit] this should NOT be logged");
    await log.flush();
    entries = await log.readRecent();
    expect(entries.some((e) => /should NOT be logged/.test(e.message))).toBe(false);
  });
});

describe("error log integration via buildGlorp", () => {
  test("bridge error events are persisted to the session error log", async () => {
    const g = await buildGlorp({ workspace, sessionId: "errsess", dataDir });
    try {
      getBridge().emit({ type: "error", message: "INTEGRATION_BOOM", detail: "at frobnicate (x.ts:42)" });
    } finally {
      await g.shutdown(); // flushes the error log
    }
    const file = resolveSessionPaths(dataDir, "errsess").errorsFile;
    expect(fs.existsSync(file)).toBe(true);
    const entries = fs.readFileSync(file, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    const hit = entries.find((e: any) => e.message === "INTEGRATION_BOOM");
    expect(hit).toBeDefined();
    expect(hit.source).toBe("agent");
    expect(hit.detail).toContain("frobnicate");
    expect(hit.agentId).toBe("main");
  });
});
