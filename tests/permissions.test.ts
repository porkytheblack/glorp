import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { buildGlorp } from "../src/agent/glorp.ts";
import { getBridge } from "../src/shared/bridge.ts";
import { readTool } from "../src/agent/tools/read.ts";
import { writeTool } from "../src/agent/tools/write.ts";
import { editTool } from "../src/agent/tools/edit.ts";
import { bashTool } from "../src/agent/tools/bash.ts";
import { fleetDispatchTool } from "../src/agent/tools/fleet-dispatch.ts";
import type { GlorpFleet } from "../src/agent/station-bridge.ts";

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "sk-test";

let dataDir: string;
let workspace: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-perm-data-"));
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-perm-ws-"));
});

afterEach(() => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {}
  try {
    fs.rmSync(workspace, { recursive: true, force: true });
  } catch {}
});

describe("requiresPermission flags on tools", () => {
  test("bash requires permission", () => {
    expect(bashTool(workspace).requiresPermission).toBe(true);
  });
  test("write requires permission", () => {
    expect(writeTool(workspace).requiresPermission).toBe(true);
  });
  test("edit requires permission", () => {
    expect(editTool(workspace).requiresPermission).toBe(true);
  });
  test("dispatch_fleet requires permission", () => {
    const fakeFleet = {} as GlorpFleet;
    const tool = fleetDispatchTool(fakeFleet, { current: null });
    expect(tool.requiresPermission).toBe(true);
  });
  test("read does NOT require permission (read-only)", () => {
    expect(readTool(workspace).requiresPermission).toBeFalsy();
  });
});

describe("buildGlorp wires permissions through to the store", () => {
  test("getPermission/setPermission round-trip via GlorpHandle.clearPermission", async () => {
    const g = await buildGlorp({ workspace, sessionId: "perm-1", dataDir });
    try {
      await g.store.setPermission("bash", "granted");
      expect(await g.store.getPermission("bash")).toBe("granted");
      await g.clearPermission("bash");
      expect(await g.store.getPermission("bash")).toBe("unset");
    } finally {
      await g.shutdown();
    }
  });

  test("granted permission persists across store re-instantiation", async () => {
    const g = await buildGlorp({ workspace, sessionId: "perm-persist", dataDir });
    await g.store.setPermission("write", "granted");
    await new Promise((r) => setTimeout(r, 200)); // flush coalescer
    await g.shutdown();

    const g2 = await buildGlorp({ workspace, sessionId: "perm-persist", dataDir });
    try {
      expect(await g2.store.getPermission("write")).toBe("granted");
    } finally {
      await g2.shutdown();
    }
  });
});

describe("permission_request bridge event", () => {
  test("emits when a permission_request slot lands on the displayManager", async () => {
    const g = await buildGlorp({ workspace, sessionId: "perm-bridge", dataDir });
    try {
      const events: any[] = [];
      const unsub = getBridge().subscribe((e) => events.push(e));

      // Directly push a permission_request slot, simulating what Glove's
      // executor does when a requiresPermission tool fires with status=unset.
      const dm = (g.agent as any).displayManager;
      const pushPromise = dm.pushAndWait({
        renderer: "permission_request",
        input: { toolName: "bash", toolInput: { command: "ls", description: "list" } },
      });

      // Give the subscribe listener a tick to run.
      await new Promise((r) => setTimeout(r, 50));
      const req = events.find((e) => e.type === "permission_request");
      expect(req).toBeDefined();
      expect(req.request.toolName).toBe("bash");
      expect((req.request.toolInput as any).command).toBe("ls");
      expect(typeof req.request.slotId).toBe("string");

      // Resolve via GlorpHandle.resolvePermission (the wire the UI uses).
      g.resolvePermission(req.request.slotId, true);
      const result = await pushPromise;
      expect(result).toBe(true);

      // permission_resolved bridge event fires too.
      const resolved = events.find((e) => e.type === "permission_resolved");
      expect(resolved).toBeDefined();
      expect(resolved.slotId).toBe(req.request.slotId);
      unsub();
    } finally {
      await g.shutdown();
    }
  });

  test("does NOT emit for non-permission slots", async () => {
    const g = await buildGlorp({ workspace, sessionId: "perm-nonperm", dataDir });
    try {
      const events: any[] = [];
      const unsub = getBridge().subscribe((e) => events.push(e));

      const dm = (g.agent as any).displayManager;
      // Push a regular slot — should NOT emit a permission_request event.
      const promise = dm.pushAndWait({
        renderer: "some_other_renderer",
        input: { hi: 1 },
      });
      await new Promise((r) => setTimeout(r, 50));
      const req = events.find((e) => e.type === "permission_request");
      expect(req).toBeUndefined();

      dm.resolve(dm.stack[dm.stack.length - 1].id, "ok");
      await promise;
      unsub();
    } finally {
      await g.shutdown();
    }
  });
});

describe("GlorpHandle.sessionId is set", () => {
  test("matches the sessionId passed at build time", async () => {
    const g = await buildGlorp({ workspace, sessionId: "abc-123", dataDir });
    try {
      expect(g.sessionId).toBe("abc-123");
    } finally {
      await g.shutdown();
    }
  });
});
