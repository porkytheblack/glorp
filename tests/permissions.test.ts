import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { buildGlorp } from "../src/agent/glorp.ts";
import { getBridge } from "../src/shared/bridge.ts";
import { readTool } from "../src/agent/tools/read.ts";
import { writeTool } from "../src/agent/tools/write.ts";
import { editTool } from "../src/agent/tools/edit.ts";
import { applyPatchTool } from "../src/agent/tools/apply-patch.ts";
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
  test("apply_patch requires permission", () => {
    expect(applyPatchTool(workspace).requiresPermission).toBe(true);
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
  test("emits display_slot_pushed when a permission_request lands", async () => {
    const g = await buildGlorp({ workspace, sessionId: "perm-bridge", dataDir });
    try {
      const events: any[] = [];
      const unsub = getBridge().subscribe((e) => events.push(e));

      const dm = (g.agent as any).displayManager;
      const pushPromise = dm.pushAndWait({
        renderer: "permission_request",
        input: { toolName: "bash", toolInput: { command: "ls", description: "list" } },
      });

      await new Promise((r) => setTimeout(r, 50));
      const ev = events.find(
        (e) => e.type === "display_slot_pushed" && e.slot.renderer === "permission_request",
      );
      expect(ev).toBeDefined();
      expect(ev.slot.isPermissionRequest).toBe(true);
      expect((ev.slot.input as any).toolName).toBe("bash");
      expect(typeof ev.slot.slotId).toBe("string");

      // Resolve via GlorpHandle.resolvePermission (back-compat) — should also
      // work via the generic resolveSlot path.
      g.resolvePermission(ev.slot.slotId, true);
      const result = await pushPromise;
      expect(result).toBe(true);

      const resolved = events.find((e) => e.type === "display_slot_resolved");
      expect(resolved).toBeDefined();
      expect(resolved.slotId).toBe(ev.slot.slotId);
      unsub();
    } finally {
      await g.shutdown();
    }
  });

  test("generic display_slot bridges non-permission renderers too", async () => {
    const g = await buildGlorp({ workspace, sessionId: "perm-generic", dataDir });
    try {
      const events: any[] = [];
      const unsub = getBridge().subscribe((e) => events.push(e));

      const dm = (g.agent as any).displayManager;
      const pushPromise = dm.pushAndWait({
        renderer: "confirm",
        input: { message: "delete it?" },
      });
      await new Promise((r) => setTimeout(r, 50));
      const ev = events.find(
        (e) => e.type === "display_slot_pushed" && e.slot.renderer === "confirm",
      );
      expect(ev).toBeDefined();
      expect(ev.slot.isPermissionRequest).toBe(false);

      g.resolveSlot(ev.slot.slotId, true);
      const result = await pushPromise;
      expect(result).toBe(true);
      unsub();
    } finally {
      await g.shutdown();
    }
  });

  test("rejectSlot rejects the pushAndWait promise", async () => {
    const g = await buildGlorp({ workspace, sessionId: "perm-reject", dataDir });
    try {
      const events: any[] = [];
      const unsub = getBridge().subscribe((e) => events.push(e));

      const dm = (g.agent as any).displayManager;
      const pushPromise = dm.pushAndWait({
        renderer: "text_input",
        input: { question: "your name?" },
      });
      await new Promise((r) => setTimeout(r, 50));
      const ev = events.find((e) => e.type === "display_slot_pushed");
      expect(ev).toBeDefined();

      g.rejectSlot(ev.slot.slotId, "user cancelled");
      await expect(pushPromise).rejects.toThrow();
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
