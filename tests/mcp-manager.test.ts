import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { McpActiveStore } from "../src/agent/mcp/active-store.ts";
import { McpManager } from "../src/agent/mcp/manager.ts";
import { Bridge } from "../src/shared/bridge.ts";
import type { BridgeEvent } from "../src/shared/events.ts";
import type { McpSection } from "../src/agent/mcp/config.ts";
import type { IGloveRunnable } from "glove-core/glove";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-mcp-"));
});

afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

describe("McpActiveStore", () => {
  test("reports config defaults before any write", () => {
    const store = new McpActiveStore(path.join(dir, "mcp.json"), () => ["a", "b"]);
    expect(store.load()).toEqual(["a", "b"]);
    expect(fs.existsSync(path.join(dir, "mcp.json"))).toBe(false);
  });

  test("set persists and survives a fresh instance", () => {
    const file = path.join(dir, "mcp.json");
    const store = new McpActiveStore(file, () => ["a", "b"]);
    expect(store.set("b", false)).toBe(true);
    expect(store.load()).toEqual(["a"]);
    const reloaded = new McpActiveStore(file, () => ["a", "b"]);
    expect(reloaded.load()).toEqual(["a"]);
    expect(reloaded.set("c", true)).toBe(true);
    expect(reloaded.load()).toEqual(["a", "c"]);
  });

  test("set is a no-op when nothing changes", () => {
    const store = new McpActiveStore(path.join(dir, "mcp.json"), () => ["a"]);
    expect(store.set("a", true)).toBe(false);
    expect(store.set("missing", false)).toBe(false);
  });
});

const SECTION: McpSection = {
  alpha: { url: "http://127.0.0.1:1/mcp", description: "unreachable test server" },
  beta: { url: "https://beta.example.com/mcp", autoConnect: false },
};

function makeManager(section: McpSection = SECTION) {
  const bridge = new Bridge();
  const events: BridgeEvent[] = [];
  bridge.subscribe((ev) => events.push(ev));
  const manager = new McpManager(section, path.join(dir, "mcp.json"), bridge, "test-session");
  return { manager, events };
}

/** A minimal fold/defineSubAgent recorder standing in for the live agent. */
function stubAgent() {
  const folded: unknown[] = [];
  const subagents: unknown[] = [];
  const agent = {
    fold: (args: unknown) => { folded.push(args); return agent; },
    defineSubAgent: (args: unknown) => { subagents.push(args); return agent; },
  };
  return { agent: agent as unknown as IGloveRunnable, folded, subagents };
}

describe("McpManager", () => {
  test("seeds one inactive status per catalogue entry", () => {
    const { manager } = makeManager();
    const list = manager.list();
    expect(list.map((s) => s.id)).toEqual(["alpha", "beta"]);
    expect(list[0]).toMatchObject({ active: true, state: "inactive", toolCount: 0 });
    expect(list[1]).toMatchObject({ active: false, state: "inactive" });
  });

  test("hasServers is false for an empty section and mount is a no-op", async () => {
    const { manager, events } = makeManager({});
    expect(manager.hasServers).toBe(false);
    const { agent, folded, subagents } = stubAgent();
    await manager.mount(agent);
    expect(folded).toHaveLength(0);
    expect(subagents).toHaveLength(0);
    expect(events).toHaveLength(0);
    manager.emitStatus();
    expect(events).toHaveLength(0);
  });

  test("mount marks unreachable active servers as error and still registers discovery", async () => {
    const { manager, events } = makeManager();
    const { agent, folded, subagents } = stubAgent();
    await manager.mount(agent);
    expect(folded).toHaveLength(0);
    expect(subagents).toHaveLength(1);
    const status = events.findLast((e) => e.type === "mcp_status");
    expect(status).toBeDefined();
    if (status?.type !== "mcp_status") throw new Error("unreachable");
    const alpha = status.servers.find((s) => s.id === "alpha")!;
    expect(alpha.state).toBe("error");
    expect(alpha.error).toBeTruthy();
    // beta is autoConnect:false — untouched by mount
    expect(status.servers.find((s) => s.id === "beta")!.state).toBe("inactive");
  });

  test("setActive persists the toggle and ignores unknown ids", () => {
    const { manager } = makeManager();
    expect(manager.setActive("nope", true)).toBe(false);
    expect(manager.setActive("beta", true)).toBe(true);
    expect(manager.setActive("beta", true)).toBe(false);
    const reloaded = makeManager().manager;
    expect(reloaded.list().find((s) => s.id === "beta")!.active).toBe(true);
  });

  test("adapter activate/deactivate updates status and emits", async () => {
    const { manager, events } = makeManager();
    await manager.adapter.activate("beta");
    let last = events.at(-1);
    if (last?.type !== "mcp_status") throw new Error("expected mcp_status");
    expect(last.servers.find((s) => s.id === "beta")).toMatchObject({ active: true, state: "connected" });
    await manager.adapter.deactivate("beta");
    last = events.at(-1);
    if (last?.type !== "mcp_status") throw new Error("expected mcp_status");
    expect(last.servers.find((s) => s.id === "beta")).toMatchObject({ active: false, state: "inactive" });
  });

  test("adapter.getActive filters ids that are not in the catalogue", async () => {
    const file = path.join(dir, "mcp.json");
    fs.writeFileSync(file, JSON.stringify({ active: ["alpha", "ghost"] }));
    const { manager } = makeManager();
    expect(await manager.adapter.getActive()).toEqual(["alpha"]);
  });

  test("getAccessToken returns the configured token or empty string", async () => {
    const { manager } = makeManager({ a: { url: "https://a.example/mcp", auth: "tok" } });
    expect(await manager.adapter.getAccessToken("a")).toBe("tok");
    expect(await manager.adapter.getAccessToken("missing")).toBe("");
  });
});
