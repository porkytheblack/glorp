/**
 * Glorp Station backend tests. These exercise everything that doesn't require
 * a live LLM: per-session event isolation, the WS envelope, the session
 * manager (CRUD + rehydration), the in-memory credentials overlay, the
 * template engine, config resolution, and the HTTP surface end to end.
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import { EventStream, type StreamClient } from "../src/station/event-stream.ts";
import { StationSession } from "../src/station/session.ts";
import { SessionManager } from "../src/station/manager.ts";
import { SessionCredentialsStore } from "../src/station/credentials.ts";
import { interpolate, provision } from "../src/station/templates/engine.ts";
import { TemplateStore } from "../src/station/templates/store.ts";
import { loadStationConfig } from "../src/station/config.ts";
import { startStation } from "../src/station/server.ts";
import { GlorpStore } from "../src/agent/store.ts";
import type { BridgeEvent } from "../src/shared/events.ts";

const tmpDirs: string[] = [];
function tmp(prefix = "station-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      server.close(() => resolve(typeof addr === "object" && addr ? addr.port : 0));
    });
  });
}

function captureClient(id: string): { client: StreamClient; sent: string[] } {
  const sent: string[] = [];
  return { sent, client: { id, send: (d) => sent.push(d), readyState: 1, seq: 0 } };
}

function makeSession(id: string, dataDir: string): StationSession {
  return new StationSession({ id, workspace: path.join(dataDir, id), dataDir, permissionMode: "normal" });
}

describe("EventStream", () => {
  it("wraps events in a { sessionId, seq, event } envelope", () => {
    const stream = new EventStream("sess-1");
    const { client, sent } = captureClient("c1");
    stream.add(client);
    stream.broadcast({ type: "busy", busy: true });
    const env = JSON.parse(sent[0]!);
    expect(env.sessionId).toBe("sess-1");
    expect(env.seq).toBe(1);
    expect(env.event).toEqual({ type: "busy", busy: true });
  });

  it("increments seq per client and skips closed sockets", () => {
    const stream = new EventStream("s");
    const a = captureClient("a");
    const closed: StreamClient = { id: "b", send: () => { throw new Error("closed"); }, readyState: 3, seq: 0 };
    stream.add(a.client);
    stream.add(closed);
    stream.broadcast({ type: "text_delta", text: "x" });
    stream.broadcast({ type: "text_delta", text: "y" });
    expect(a.sent.map((s) => JSON.parse(s).seq)).toEqual([1, 2]);
  });
});

describe("Session isolation (success metric: 5 concurrent, no cross-talk)", () => {
  it("keeps each session's events on its own stream", () => {
    const dataDir = tmp();
    const sessions = Array.from({ length: 5 }, (_, i) => makeSession(`s${i}`, dataDir));
    const caps = sessions.map((s, i) => {
      const cap = captureClient(`client-${i}`);
      s.stream.add(cap.client);
      return cap;
    });

    // Emit a uniquely-identifiable event on each session's own bridge.
    sessions.forEach((s, i) => s.bridge.emit({ type: "title", title: `title-${i}` } as BridgeEvent));

    caps.forEach((cap, i) => {
      expect(cap.sent).toHaveLength(1);
      expect(JSON.parse(cap.sent[0]!).event).toEqual({ type: "title", title: `title-${i}` });
    });
  });

  it("tracks busy/idle lifecycle from its own bus", () => {
    const s = makeSession("busy-test", tmp());
    expect(s.state).toBe("provisioning");
    s.bridge.emit({ type: "busy", busy: true });
    expect(s.stats.busy).toBe(true);
    expect(s.state).toBe("busy");
    s.bridge.emit({ type: "busy", busy: false });
    expect(s.state).toBe("idle");
  });

  it("redacts the custom API key in its DTO (provider + last4 only)", () => {
    const s = new StationSession({
      id: "cred-dto",
      workspace: path.join(tmp(), "w"),
      dataDir: tmp(),
      permissionMode: "normal",
      customCredential: { provider: "anthropic", apiKey: "fixture-key-7788" },
    });
    const dto = s.toDto();
    expect(dto.custom_credentials).toEqual({ provider: "anthropic", last4: "7788" });
    expect(JSON.stringify(dto)).not.toContain("secret");
  });
});

describe("SessionManager", () => {
  it("creates, gets, lists and destroys sessions", async () => {
    const dataDir = tmp();
    const mgr = new SessionManager({ dataDir, workspaceRoot: path.join(dataDir, "ws"), permissionMode: "normal" });
    const s = await mgr.create({ sessionId: "alpha" });
    expect(mgr.get("alpha")).toBe(s);
    expect(mgr.liveCount).toBe(1);
    const list = await mgr.list();
    expect(list.find((x) => x.id === "alpha")).toBeTruthy();
    expect(await mgr.destroy("alpha")).toBe(true);
    expect(mgr.get("alpha")).toBeUndefined();
  });

  it("rejects a duplicate session id", async () => {
    const dataDir = tmp();
    const mgr = new SessionManager({ dataDir, workspaceRoot: path.join(dataDir, "ws"), permissionMode: "normal" });
    await mgr.create({ sessionId: "dup" });
    await expect(mgr.create({ sessionId: "dup" })).rejects.toThrow(/already exists/);
  });

  it("rehydrates a dormant on-disk snapshot", async () => {
    const dataDir = tmp();
    const store = new GlorpStore("ghost", dataDir, { workspace: path.join(dataDir, "ws") });
    await store.setTitle("Ghost session");
    await store.flush();

    const mgr = new SessionManager({ dataDir, workspaceRoot: path.join(dataDir, "ws"), permissionMode: "normal" });
    const list = await mgr.list();
    const ghost = list.find((x) => x.id === "ghost");
    expect(ghost?.loaded).toBe(false);
    // getOrRehydrate registers it without building the agent.
    const rehydrated = mgr.getOrRehydrate("ghost");
    expect(rehydrated?.id).toBe("ghost");
    expect(rehydrated?.loaded).toBe(false);
  });

  it("provisions a workspace from a template and cleans up on failure", async () => {
    const dataDir = tmp();
    const templatesDir = path.join(dataDir, "templates");
    fs.mkdirSync(templatesDir, { recursive: true });
    fs.writeFileSync(
      path.join(templatesDir, "ok.json"),
      JSON.stringify({ steps: [{ type: "shell", command: "echo seeded > seeded.txt" }] }),
    );
    fs.writeFileSync(
      path.join(templatesDir, "bad.json"),
      JSON.stringify({ steps: [{ type: "shell", command: "exit 3" }] }),
    );
    const templates = new TemplateStore(templatesDir);
    const mgr = new SessionManager({
      dataDir,
      workspaceRoot: path.join(dataDir, "ws"),
      permissionMode: "normal",
      templates: { has: (n) => templates.has(n), provision: (n, p, w) => provision(templates.get(n)!, p, w) },
    });

    const ok = await mgr.create({ sessionId: "tmpl-ok", template: "ok" });
    expect(fs.existsSync(path.join(ok.workspace, "seeded.txt"))).toBe(true);

    const badWorkspace = path.join(dataDir, "ws", "tmpl-bad");
    await expect(mgr.create({ sessionId: "tmpl-bad", template: "bad" })).rejects.toThrow(/provisioning failed/);
    expect(fs.existsSync(badWorkspace)).toBe(false);
  });
});

describe("SessionCredentialsStore (in-memory overlay, never persisted)", () => {
  it("overlays a custom key without writing credentials.json", () => {
    const dataDir = tmp();
    const store = new SessionCredentialsStore(dataDir, {
      custom: { provider: "anthropic", apiKey: "sk-test-123", model: "claude-test" },
    });
    const active = store.getActiveProfile();
    expect(active?.providerId).toBe("anthropic");
    expect(active?.model).toBe("claude-test");
    expect(store.getProvider("anthropic")?.apiKey).toBe("sk-test-123");
    expect(fs.existsSync(path.join(dataDir, "credentials.json"))).toBe(false);
  });

  it("setActive and clearCustom stay in memory", () => {
    const dataDir = tmp();
    const store = new SessionCredentialsStore(dataDir, {
      custom: { provider: "anthropic", apiKey: "sk-test-123", model: "claude-test" },
    });
    store.setActive("anything");
    store.clearCustom();
    expect(store.getActiveProfile()).toBeUndefined();
    expect(fs.existsSync(path.join(dataDir, "credentials.json"))).toBe(false);
  });
});

describe("Audit fixes", () => {
  it("destroy deletes the on-disk snapshot so the session can't resurrect", async () => {
    const dataDir = tmp();
    const store = new GlorpStore("doomed", dataDir, { workspace: path.join(dataDir, "ws") });
    await store.setTitle("Doomed");
    await store.flush();
    const mgr = new SessionManager({ dataDir, workspaceRoot: path.join(dataDir, "ws"), permissionMode: "normal" });

    expect(await mgr.destroy("doomed")).toBe(true);
    expect(fs.existsSync(path.join(dataDir, "sessions", "doomed.json"))).toBe(false);
    expect(mgr.getOrRehydrate("doomed")).toBeUndefined();
  });

  it("destroy with ?workspace=true removes the workspace dir", async () => {
    const dataDir = tmp();
    const mgr = new SessionManager({ dataDir, workspaceRoot: path.join(dataDir, "ws"), permissionMode: "normal" });
    const s = await mgr.create({ sessionId: "with-ws" });
    fs.writeFileSync(path.join(s.workspace, "marker.txt"), "x");
    await mgr.destroy("with-ws", { workspace: true });
    expect(fs.existsSync(s.workspace)).toBe(false);
  });
});

describe("Template engine", () => {
  it("interpolates {param:..} and {env:..} and throws on missing", () => {
    expect(interpolate("{param:repo}/x", { repo: "acme" })).toBe("acme/x");
    expect(interpolate("{env:STATION_TEST_VAR}", {}, { STATION_TEST_VAR: "v" } as NodeJS.ProcessEnv)).toBe("v");
    expect(() => interpolate("{param:missing}", {})).toThrow(/Missing param/);
  });

  it("runs shell + copy steps and fails on a non-zero exit", async () => {
    const ws = tmp("station-tmpl-");
    const src = path.join(ws, "src.txt");
    fs.writeFileSync(src, "hello");
    await provision(
      { name: "t", steps: [{ type: "shell", command: "echo hi > out.txt" }, { type: "copy", from: src, to: "copied.txt" }] },
      {},
      ws,
    );
    expect(fs.readFileSync(path.join(ws, "out.txt"), "utf-8").trim()).toBe("hi");
    expect(fs.readFileSync(path.join(ws, "copied.txt"), "utf-8")).toBe("hello");

    await expect(provision({ name: "t", steps: [{ type: "shell", command: "exit 2" }] }, {}, ws)).rejects.toThrow();
  });

  it("rejects a copy step that escapes the workspace", async () => {
    const ws = tmp("station-tmpl-");
    fs.writeFileSync(path.join(ws, "src.txt"), "x");
    await expect(
      provision({ name: "t", steps: [{ type: "copy", from: path.join(ws, "src.txt"), to: "../escape.txt" }] }, {}, ws),
    ).rejects.toThrow(/within the workspace/);
  });

  it("scrubs interpolated secret values out of error messages", async () => {
    const ws = tmp("station-tmpl-");
    let thrown = "";
    try {
      await provision(
        { name: "t", steps: [{ type: "shell", command: "echo {param:tok} >&2; exit 1" }] },
        { tok: "SUPER-SECRET-TOKEN" },
        ws,
      );
    } catch (err) {
      thrown = err instanceof Error ? err.message : String(err);
    }
    expect(thrown).not.toContain("SUPER-SECRET-TOKEN");
    expect(thrown).toContain("***");
  });
});

describe("loadStationConfig", () => {
  it("layers defaults < station.json < overrides", () => {
    const dataDir = tmp();
    fs.writeFileSync(path.join(dataDir, "station.json"), JSON.stringify({ port: 9999 }));
    const base = loadStationConfig({ dataDir });
    expect(base.port).toBe(9999);
    expect(base.hostname).toBe("127.0.0.1");
    const overridden = loadStationConfig({ dataDir, port: 5000 });
    expect(overridden.port).toBe(5000);
  });
});

describe("HTTP surface (integration)", () => {
  it("serves health, session CRUD, state, models and rehydration", async () => {
    const dataDir = tmp();
    const config = loadStationConfig({ dataDir, port: await freePort(), hostname: "127.0.0.1" });
    const station = await startStation(config);
    const base = `http://127.0.0.1:${station.port}`;
    const call = async (method: string, p: string, body?: unknown) => {
      const r = await fetch(base + p, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await r.text();
      return { status: r.status, body: text ? JSON.parse(text) : null };
    };

    try {
      expect((await call("GET", "/health")).status).toBe(200);

      const ws = path.join(dataDir, "explicit-ws");
      fs.mkdirSync(ws, { recursive: true });
      const created = await call("POST", "/sessions", { workspace: ws });
      expect(created.status).toBe(201);
      expect(created.body.ws_url).toContain(`:${station.port}/api/v1/sessions/`);
      const id = created.body.id;

      expect((await call("GET", "/sessions")).body.total).toBeGreaterThanOrEqual(1);
      expect((await call("GET", `/sessions/${id}`)).body.state).toBe("provisioning");
      expect((await call("POST", `/sessions/${id}/abort`)).status).toBe(200);
      expect((await call("GET", `/sessions/${id}/history`)).body.turns).toEqual([]);
      expect((await call("GET", "/models/providers")).status).toBe(200);
      expect((await call("GET", "/models/profiles")).status).toBe(200);
      expect((await call("GET", "/sessions/nope")).status).toBe(404);

      // Rehydration: a snapshot written "by a previous process" is served.
      const store = new GlorpStore("prev", dataDir, { workspace: ws });
      await store.appendMessages([
        { id: "m1", sender: "user", text: "earlier message", tool_calls: [], tool_results: [] } as never,
      ]);
      await store.flush();
      const hist = await call("GET", "/sessions/prev/history");
      expect(hist.body.turns[0]?.text).toBe("earlier message");

      expect((await call("DELETE", `/sessions/${id}`)).status).toBe(204);
    } finally {
      await station.stop();
    }
  });
});
