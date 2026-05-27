import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { FileMeshAdapter } from "../../src/orchestrator/mesh-setup.ts";
import type { MeshMessage, IncomingMeshMessage } from "glove-mesh";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mesh-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("FileMeshAdapter", () => {
  describe("register / unregister", () => {
    test("register creates agent identity file", async () => {
      const adapter = new FileMeshAdapter("agent-a", tmpDir);
      await adapter.register({ id: "agent-a", name: "Agent A", description: "test", capabilities: ["read"] });
      const file = path.join(tmpDir, "agents", "agent-a.json");
      expect(fs.existsSync(file)).toBe(true);
      const data = JSON.parse(fs.readFileSync(file, "utf-8"));
      expect(data.id).toBe("agent-a");
      expect(data.capabilities).toEqual(["read"]);
    });

    test("register creates inbox directory", async () => {
      const adapter = new FileMeshAdapter("agent-a", tmpDir);
      await adapter.register({ id: "agent-a", name: "A", description: "", capabilities: [] });
      expect(fs.existsSync(path.join(tmpDir, "inbox", "agent-a"))).toBe(true);
    });

    test("unregister removes identity file", async () => {
      const adapter = new FileMeshAdapter("agent-a", tmpDir);
      await adapter.register({ id: "agent-a", name: "A", description: "", capabilities: [] });
      await adapter.unregister();
      expect(fs.existsSync(path.join(tmpDir, "agents", "agent-a.json"))).toBe(false);
    });

    test("unregister stops polling", async () => {
      const adapter = new FileMeshAdapter("agent-a", tmpDir);
      await adapter.register({ id: "agent-a", name: "A", description: "", capabilities: [] });
      adapter.subscribe(async () => {});
      await adapter.unregister();
      // No assertion needed — verifies no crash or hanging timer
    });

    test("double unregister is safe", async () => {
      const adapter = new FileMeshAdapter("agent-a", tmpDir);
      await adapter.register({ id: "agent-a", name: "A", description: "", capabilities: [] });
      await adapter.unregister();
      await expect(adapter.unregister()).resolves.toBeUndefined();
    });
  });

  describe("listAgents", () => {
    test("returns registered agents", async () => {
      const a = new FileMeshAdapter("a", tmpDir);
      const b = new FileMeshAdapter("b", tmpDir);
      await a.register({ id: "a", name: "A", description: "", capabilities: [] });
      await b.register({ id: "b", name: "B", description: "", capabilities: [] });

      const list = await a.listAgents();
      expect(list).toHaveLength(2);
      const ids = list.map((x) => x.id).sort();
      expect(ids).toEqual(["a", "b"]);

      await a.unregister();
      await b.unregister();
    });

    test("returns empty array when no agents dir", async () => {
      const adapter = new FileMeshAdapter("x", tmpDir);
      const list = await adapter.listAgents();
      expect(list).toEqual([]);
    });
  });

  describe("getAgent", () => {
    test("returns agent identity", async () => {
      const adapter = new FileMeshAdapter("a", tmpDir);
      await adapter.register({ id: "a", name: "Agent A", description: "desc", capabilities: ["c"] });
      const identity = await adapter.getAgent("a");
      expect(identity?.name).toBe("Agent A");
      await adapter.unregister();
    });

    test("returns null for unknown agent", async () => {
      const adapter = new FileMeshAdapter("a", tmpDir);
      expect(await adapter.getAgent("unknown")).toBeNull();
    });
  });

  describe("send", () => {
    test("writes message to recipient inbox", async () => {
      const sender = new FileMeshAdapter("sender", tmpDir);
      await sender.register({ id: "sender", name: "S", description: "", capabilities: [] });

      const receiver = new FileMeshAdapter("receiver", tmpDir);
      await receiver.register({ id: "receiver", name: "R", description: "", capabilities: [] });

      await sender.send({
        id: "msg1",
        from: "sender",
        to: "receiver",
        content: "hello",
        created_at: new Date().toISOString(),
      } as MeshMessage);

      const inboxDir = path.join(tmpDir, "inbox", "receiver");
      const files = fs.readdirSync(inboxDir).filter((f) => f.endsWith(".json"));
      expect(files).toHaveLength(1);

      const msg = JSON.parse(fs.readFileSync(path.join(inboxDir, files[0]), "utf-8"));
      expect(msg.content).toBe("hello");
      expect(msg.from).toBe("sender");

      await sender.unregister();
      await receiver.unregister();
    });

    test("no-ops when to is undefined", async () => {
      const adapter = new FileMeshAdapter("a", tmpDir);
      await adapter.send({ id: "x", from: "a", content: "hi", created_at: "" } as any);
      // Should not throw or create files
    });
  });

  describe("broadcast", () => {
    test("sends to all except self", async () => {
      const a = new FileMeshAdapter("a", tmpDir);
      const b = new FileMeshAdapter("b", tmpDir);
      const c = new FileMeshAdapter("c", tmpDir);

      await a.register({ id: "a", name: "A", description: "", capabilities: [] });
      await b.register({ id: "b", name: "B", description: "", capabilities: [] });
      await c.register({ id: "c", name: "C", description: "", capabilities: [] });

      await a.broadcast({ id: "bcast1", from: "a", content: "hi all", created_at: "" });

      const bFiles = fs.readdirSync(path.join(tmpDir, "inbox", "b")).filter((f) => f.endsWith(".json"));
      const cFiles = fs.readdirSync(path.join(tmpDir, "inbox", "c")).filter((f) => f.endsWith(".json"));
      const aFiles = fs.readdirSync(path.join(tmpDir, "inbox", "a")).filter((f) => f.endsWith(".json"));

      expect(bFiles).toHaveLength(1);
      expect(cFiles).toHaveLength(1);
      expect(aFiles).toHaveLength(0); // self excluded

      await a.unregister();
      await b.unregister();
      await c.unregister();
    });
  });

  describe("subscribe / polling", () => {
    test("picks up new inbox messages", async () => {
      const adapter = new FileMeshAdapter("listener", tmpDir);
      await adapter.register({ id: "listener", name: "L", description: "", capabilities: [] });

      const received: IncomingMeshMessage[] = [];
      adapter.subscribe(async (msg) => received.push(msg));

      // Drop a message file directly into inbox
      const inboxDir = path.join(tmpDir, "inbox", "listener");
      const msg = { id: "m1", from: "ext", to: "listener", content: "ping", created_at: "" };
      fs.writeFileSync(path.join(inboxDir, "test_msg.json"), JSON.stringify(msg));

      // Wait for polling to pick it up
      await new Promise((r) => setTimeout(r, 250));

      expect(received).toHaveLength(1);
      expect(received[0].content).toBe("ping");

      // File should be deleted after processing
      const remaining = fs.readdirSync(inboxDir).filter((f) => f.endsWith(".json"));
      expect(remaining).toHaveLength(0);

      await adapter.unregister();
    });

    test("deduplicates messages", async () => {
      const adapter = new FileMeshAdapter("dedup", tmpDir);
      await adapter.register({ id: "dedup", name: "D", description: "", capabilities: [] });

      const received: IncomingMeshMessage[] = [];
      // Handler that doesn't process (simulates slow handler that sees same file twice)
      adapter.subscribe(async (msg) => received.push(msg));

      const inboxDir = path.join(tmpDir, "inbox", "dedup");
      const msg = { id: "d1", from: "x", to: "dedup", content: "test", created_at: "" };
      fs.writeFileSync(path.join(inboxDir, "dup.json"), JSON.stringify(msg));

      await new Promise((r) => setTimeout(r, 300));

      // Should only receive once despite multiple poll cycles
      expect(received).toHaveLength(1);

      await adapter.unregister();
    });

    test("subscribe returns unsubscribe function", async () => {
      const adapter = new FileMeshAdapter("unsub", tmpDir);
      await adapter.register({ id: "unsub", name: "U", description: "", capabilities: [] });

      const unsub = adapter.subscribe(async () => {});
      expect(typeof unsub).toBe("function");
      unsub();

      await adapter.unregister();
    });
  });

  describe("identifier", () => {
    test("exposes the agent id", () => {
      const adapter = new FileMeshAdapter("my-id", tmpDir);
      expect(adapter.identifier).toBe("my-id");
    });
  });
});
