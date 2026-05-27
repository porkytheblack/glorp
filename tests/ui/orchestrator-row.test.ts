/**
 * Tests for orchestrator row detection logic.
 * Verifies isOrchestratorTurn correctly identifies orchestrator-injected turns.
 */
import { describe, test, expect } from "bun:test";
import { isOrchestratorTurn } from "../../src/ui/components/orchestrator-row.tsx";
import type { ChatTurn } from "../../src/shared/events.ts";

function makeTurn(overrides: Partial<ChatTurn> = {}): ChatTurn {
  return { id: "t1", kind: "system", createdAt: Date.now(), ...overrides };
}

describe("isOrchestratorTurn", () => {
  test("returns true for system turn with orchestrator meta", () => {
    const turn = makeTurn({ meta: { orchestrator: true, subtype: "verdict" } });
    expect(isOrchestratorTurn(turn)).toBe(true);
  });

  test("returns false for regular system turn", () => {
    const turn = makeTurn({ text: "System message" });
    expect(isOrchestratorTurn(turn)).toBe(false);
  });

  test("returns false for system turn with orchestrator=false", () => {
    const turn = makeTurn({ meta: { orchestrator: false } });
    expect(isOrchestratorTurn(turn)).toBe(false);
  });

  test("returns false for non-system turn even with orchestrator meta", () => {
    const turn = makeTurn({ kind: "agent", meta: { orchestrator: true } });
    expect(isOrchestratorTurn(turn)).toBe(false);
  });

  test("returns false for user turn", () => {
    const turn = makeTurn({ kind: "user" });
    expect(isOrchestratorTurn(turn)).toBe(false);
  });

  test("returns false for tool turn", () => {
    const turn = makeTurn({ kind: "tool" });
    expect(isOrchestratorTurn(turn)).toBe(false);
  });
});
