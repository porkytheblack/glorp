/**
 * Tests for MCP server status in the TUI reducer (src/tui/).
 */
import { describe, test, expect } from "bun:test";
import { reduceUiState, initialUiState } from "../../src/tui/store-reducer.ts";
import type { UiAction, UiState } from "../../src/tui/store-reducer.ts";
import type { McpServerStatus } from "../../src/shared/events.ts";

function apply(actions: UiAction[]): UiState {
  return actions.reduce(reduceUiState, initialUiState);
}

const SERVERS: McpServerStatus[] = [
  { id: "linear", name: "linear", url: "https://mcp.linear.app/mcp", active: true, state: "connected", toolCount: 12 },
  { id: "docs", name: "docs", url: "https://docs.example/mcp", active: false, state: "inactive", toolCount: 0 },
];

describe("store-reducer mcp_status", () => {
  test("replaces the server roster", () => {
    const state = apply([{ kind: "mcp_status", servers: SERVERS }]);
    expect(state.mcpServers).toHaveLength(2);
    expect(state.mcpServers[0]).toMatchObject({ id: "linear", state: "connected", toolCount: 12 });
  });

  test("later snapshots win entirely", () => {
    const updated: McpServerStatus[] = [{ ...SERVERS[0]!, state: "error", error: "boom", toolCount: 0 }];
    const state = apply([
      { kind: "mcp_status", servers: SERVERS },
      { kind: "mcp_status", servers: updated },
    ]);
    expect(state.mcpServers).toHaveLength(1);
    expect(state.mcpServers[0]!.state).toBe("error");
  });

  test("session_reset preserves the MCP roster", () => {
    const state = apply([
      { kind: "mcp_status", servers: SERVERS },
      { kind: "session_reset" },
    ]);
    expect(state.mcpServers).toHaveLength(2);
  });

  test("session_hydrate leaves the roster alone (re-emitted separately)", () => {
    const state = apply([
      { kind: "mcp_status", servers: SERVERS },
      { kind: "session_hydrate", turns: [], title: null, plan: null, tasks: [], inbox: [], stats: { turns: 0, tokens_in: 0, tokens_out: 0, contextPct: 0 } },
    ]);
    expect(state.mcpServers).toHaveLength(2);
  });
});
