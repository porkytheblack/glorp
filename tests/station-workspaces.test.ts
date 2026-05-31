/**
 * First-class workspace tests: the WorkspaceStore primitive, the SessionManager
 * workspace methods, lazy dormant-session migration, and the HTTP surface.
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { WorkspaceStore, workspaceIdForPath } from "../src/station/workspace-store.ts";
import { SessionManager } from "../src/station/manager.ts";
import { startStation } from "../src/station/server.ts";
import { loadStationConfig } from "../src/station/config.ts";
import { GlorpStore } from "../src/agent/store.ts";

const tmpDirs: string[] = [];
function tmp(prefix = "ws-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("WorkspaceStore", () => {
  it("derives a stable id from the resolved path", () => {
    expect(workspaceIdForPath("/a/b/../c")).toBe(workspaceIdForPath("/a/c"));
    expect(workspaceIdForPath("/a/c")).not.toBe(workspaceIdForPath("/a/d"));
    expect(workspaceIdForPath("/a/c")).toMatch(/^ws_[0-9a-f]{12}$/);
  });

  it("create is idempotent per path and persists across instances", () => {
    const dataDir = tmp();
    const repo = tmp("repo-");
    const a = new WorkspaceStore(dataDir);
    const w1 = a.create({ path: repo });
    const w2 = a.ensureForPath(repo);
    expect(w2.id).toBe(w1.id);
    expect(w1.name).toBe(path.basename(repo));
    expect(fs.existsSync(path.join(dataDir, "workspaces.json"))).toBe(true);

    // A fresh store reading the same dir sees the same workspace.
    const b = new WorkspaceStore(dataDir);
    expect(b.get(w1.id)?.path).toBe(path.resolve(repo));
  });
});

describe("SessionManager workspaces", () => {
  function mgr(dataDir: string) {
    return new SessionManager({ dataDir, workspaceRoot: path.join(dataDir, "ws"), permissionMode: "normal" });
  }

  it("creates a workspace, then a session inside it (shared folder)", async () => {
    const dataDir = tmp();
    const repo = tmp("repo-");
    const m = mgr(dataDir);
    const ws = m.createWorkspace({ path: repo });
    const s = await m.create({ workspaceId: ws.id });
    expect(s.workspaceId).toBe(ws.id);
    expect(s.workspace).toBe(path.resolve(repo)); // all sessions share the workspace folder

    const list = await m.listWorkspaces();
    const got = list.find((w) => w.id === ws.id);
    expect(got?.session_count).toBe(1);

    const sessions = await m.sessionsForWorkspace(ws.id);
    expect(sessions.map((x) => x.id)).toContain(s.id);
  });

  it("rejects sessions for an unknown workspace id", async () => {
    const m = mgr(tmp());
    await expect(m.create({ workspaceId: "ws_doesnotexist" })).rejects.toThrow(/Unknown workspace/);
  });

  it("lazily migrates a dormant on-disk session into a workspace", async () => {
    const dataDir = tmp();
    const repo = tmp("repo-");
    const store = new GlorpStore("ghost", dataDir, { workspace: repo });
    await store.setTitle("Ghost");
    await store.flush();

    const m = mgr(dataDir);
    const sessions = await m.list();
    const ghost = sessions.find((s) => s.id === "ghost");
    expect(ghost?.workspace_id).toBe(workspaceIdForPath(repo));

    // The workspace now exists with the dormant session counted.
    const ws = (await m.listWorkspaces()).find((w) => w.id === workspaceIdForPath(repo));
    expect(ws?.session_count).toBe(1);
  });

  it("deleteWorkspace can cascade-destroy its sessions", async () => {
    const dataDir = tmp();
    const repo = tmp("repo-");
    const m = mgr(dataDir);
    const ws = m.createWorkspace({ path: repo });
    await m.create({ sessionId: "to-delete", workspaceId: ws.id });
    expect(await m.deleteWorkspace(ws.id, { sessions: true })).toBe(true);
    expect(m.getWorkspace(ws.id)).toBeUndefined();
    expect((await m.sessionsForWorkspace(ws.id))).toHaveLength(0);
  });
});

describe("Workspace HTTP surface", () => {
  it("serves workspace CRUD + scoped session creation", async () => {
    const dataDir = tmp();
    const repo = tmp("repo-");
    const config = loadStationConfig({ dataDir, port: 0, hostname: "127.0.0.1" });
    const station = await startStation(config);
    const base = `http://127.0.0.1:${station.port}`;
    const call = async (method: string, p: string, body?: unknown) => {
      const r = await fetch(base + p, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const t = await r.text();
      return { status: r.status, body: t ? JSON.parse(t) : null };
    };

    try {
      const created = await call("POST", "/workspaces", { path: repo, name: "My Repo" });
      expect(created.status).toBe(201);
      const id = created.body.id;
      expect(created.body.name).toBe("My Repo");

      expect((await call("GET", "/workspaces")).body.workspaces.some((w: any) => w.id === id)).toBe(true);

      const sess = await call("POST", `/workspaces/${id}/sessions`, { permissionMode: "auto" });
      expect(sess.status).toBe(201);
      expect(sess.body.workspace_id).toBe(id);
      expect(sess.body.ws_url).toContain(`/sessions/${sess.body.id}/events`);

      const wsSessions = await call("GET", `/workspaces/${id}/sessions`);
      expect(wsSessions.body.sessions.some((s: any) => s.id === sess.body.id)).toBe(true);

      // /workspaces must be API, not the SPA fallback.
      expect((await call("GET", "/workspaces/nope")).status).toBe(404);

      expect((await call("DELETE", `/workspaces/${id}?sessions=true`)).status).toBe(204);
      expect((await call("GET", `/workspaces/${id}`)).status).toBe(404);
    } finally {
      await station.stop();
    }
  });
});
