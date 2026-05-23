import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { BridgeEvent } from "../src/shared/events.ts";
import { GlorpStore } from "../src/agent/store.ts";
import { hydrateUiSession } from "../src/agent/runtime/hydrate.ts";

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-hydrate-"));
});

afterEach(() => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {}
});

describe("hydrateUiSession", () => {
  test("replays persisted transcript without synthetic model-only messages", async () => {
    const store = new GlorpStore("resume-1", dataDir);
    await store.appendMessages([
      { sender: "user", id: "u1", text: "inspect README" },
      {
        sender: "agent",
        text: "I will inspect it.",
        tool_calls: [{ id: "call_1", tool_name: "read", input_args: { path: "README.md" } }],
      },
      {
        sender: "user",
        text: "tool results",
        tool_results: [{
          tool_name: "read",
          call_id: "call_1",
          result: { status: "success", data: "README body", renderData: { lines: 3 } },
        }],
      },
      { sender: "agent", text: "README inspected." },
      { sender: "agent", text: "Compacted summary", is_compaction: true },
      { sender: "user", text: "[internal task continuation]\ncontinue" },
    ]);
    await store.addTasks([{ id: "t1", content: "Inspect README", activeForm: "Inspecting README", status: "completed" }]);
    const events: BridgeEvent[] = [];
    await hydrateUiSession(store, { emit: (event) => events.push(event) }, 10_000);
    const hydrated = events.find((event) => event.type === "session_hydrate");
    expect(hydrated?.type).toBe("session_hydrate");
    if (hydrated?.type !== "session_hydrate") return;
    expect(hydrated.tasks[0]?.content).toBe("Inspect README");
    expect(hydrated.turns.map((turn) => turn.kind)).toEqual(["user", "agent", "tool", "agent"]);
    expect(hydrated.turns.some((turn) => turn.text?.includes("Compacted"))).toBe(false);
    const tool = hydrated.turns.find((turn) => turn.kind === "tool")?.tool;
    expect(tool?.status).toBe("success");
    expect(tool?.output).toBe("README body");
    expect(tool?.renderData).toEqual({ lines: 3 });
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
});
