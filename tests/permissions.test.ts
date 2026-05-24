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
  test("bash gates mutating commands but skips read-only ones (function form)", () => {
    const gate = bashTool(workspace).requiresPermission;
    expect(typeof gate).toBe("function");
    const fn = gate as (input: { command: string }) => boolean;
    // mutating / unknown — gate
    expect(fn({ command: "rm -rf foo" })).toBe(true);
    expect(fn({ command: "git push origin main" })).toBe(true);
    expect(fn({ command: "echo hi > /tmp/x" })).toBe(true); // redirect
    expect(fn({ command: "ls | head" })).toBe(true);        // pipe
    // observation — skip
    expect(fn({ command: "ls -la" })).toBe(false);
    expect(fn({ command: "cat README.md" })).toBe(false);
    expect(fn({ command: "git status" })).toBe(false);
    expect(fn({ command: "git log --oneline" })).toBe(false);
    expect(fn({ command: "pwd" })).toBe(false);
    expect(fn({ command: "find src -name '*.ts'" })).toBe(false);
    expect(fn({ command: "find src -delete" })).toBe(true); // -delete flips it
    expect(fn({ command: "node --version" })).toBe(false);
    expect(fn({ command: "node ./scripts/migrate.ts" })).toBe(true);
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

describe("input-keyed permission canonicalization (glove-core 3.0.6)", () => {
  test("bash keys by first command token, not by full command", async () => {
    const g = await buildGlorp({ workspace, sessionId: "perm-bash-key", dataDir });
    try {
      // Grant 'git' — every git call should be granted, rm should still re-prompt.
      await g.store.setPermission("bash", "granted", { command: "git push origin main" });
      expect(await g.store.getPermission("bash", { command: "git pull" })).toBe("granted");
      expect(await g.store.getPermission("bash", { command: "git log" })).toBe("granted");
      expect(await g.store.getPermission("bash", { command: "rm -rf foo" })).toBe("unset");
      // env-var prefix is stripped
      expect(await g.store.getPermission("bash", { command: "FOO=bar git status" })).toBe("granted");
    } finally {
      await g.shutdown();
    }
  });

  test("edit/write key by path", async () => {
    const g = await buildGlorp({ workspace, sessionId: "perm-edit-key", dataDir });
    try {
      await g.store.setPermission("edit", "granted", {
        path: "src/foo.ts",
        old_string: "a",
        new_string: "b",
      });
      expect(
        await g.store.getPermission("edit", {
          path: "src/foo.ts",
          old_string: "totally different",
          new_string: "edit on same file",
        }),
      ).toBe("granted");
      expect(await g.store.getPermission("edit", { path: "src/bar.ts" })).toBe("unset");

      await g.store.setPermission("write", "granted", { path: "out.txt", content: "x" });
      expect(await g.store.getPermission("write", { path: "out.txt", content: "y" })).toBe(
        "granted",
      );
    } finally {
      await g.shutdown();
    }
  });

  test("apply_patch keys by sorted touched paths", async () => {
    const g = await buildGlorp({ workspace, sessionId: "perm-patch-key", dataDir });
    try {
      const patchA = [
        "diff --git a/src/foo.ts b/src/foo.ts",
        "--- a/src/foo.ts",
        "+++ b/src/foo.ts",
        "@@ -1 +1 @@",
        "-a",
        "+b",
      ].join("\n");
      await g.store.setPermission("apply_patch", "granted", { patch: patchA });
      // Same patch content → same key
      expect(await g.store.getPermission("apply_patch", { patch: patchA })).toBe("granted");
      // Different file → different key
      const patchB = patchA.replace(/foo\.ts/g, "bar.ts");
      expect(await g.store.getPermission("apply_patch", { patch: patchB })).toBe("unset");
    } finally {
      await g.shutdown();
    }
  });

  test("dispatch_fleet keys by kind", async () => {
    const g = await buildGlorp({ workspace, sessionId: "perm-fleet-key", dataDir });
    try {
      await g.store.setPermission("dispatch_fleet", "granted", {
        kind: "research",
        jobs: [{ payload: "anything" }],
      });
      expect(
        await g.store.getPermission("dispatch_fleet", {
          kind: "research",
          jobs: [{ payload: "different" }],
        }),
      ).toBe("granted");
      expect(
        await g.store.getPermission("dispatch_fleet", { kind: "shell-fanout", jobs: [] }),
      ).toBe("unset");
    } finally {
      await g.shutdown();
    }
  });

  test("clearAllPermissionsFor sweeps every grant for a tool", async () => {
    const g = await buildGlorp({ workspace, sessionId: "perm-clear-all", dataDir });
    try {
      await g.store.setPermission("bash", "granted", { command: "git status" });
      await g.store.setPermission("bash", "granted", { command: "rm -rf foo" });
      await g.store.setPermission("edit", "granted", { path: "src/x.ts" });

      expect(g.store.listPermissions()).toHaveLength(3);

      await g.store.clearAllPermissionsFor("bash");
      const remaining = g.store.listPermissions();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.key).toBe("edit:src/x.ts");
    } finally {
      await g.shutdown();
    }
  });

  test("clearPermissionKey removes a single canonical key", async () => {
    const g = await buildGlorp({ workspace, sessionId: "perm-clear-key", dataDir });
    try {
      await g.store.setPermission("bash", "granted", { command: "git status" });
      await g.store.setPermission("bash", "granted", { command: "ls" });
      await g.store.clearPermissionKey("bash:git");
      expect(await g.store.getPermission("bash", { command: "git log" })).toBe("unset");
      expect(await g.store.getPermission("bash", { command: "ls -la" })).toBe("granted");
    } finally {
      await g.shutdown();
    }
  });

  test("listPermissions returns canonical keys sorted", async () => {
    const g = await buildGlorp({ workspace, sessionId: "perm-list", dataDir });
    try {
      await g.store.setPermission("bash", "granted", { command: "rm -rf foo" });
      await g.store.setPermission("bash", "denied", { command: "git push" });
      await g.store.setPermission("edit", "granted", { path: "src/a.ts" });
      const list = g.store.listPermissions();
      expect(list.map((r) => r.key)).toEqual(["bash:git", "bash:rm", "edit:src/a.ts"]);
      expect(list.find((r) => r.key === "bash:git")?.status).toBe("denied");
    } finally {
      await g.shutdown();
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
