/**
 * Tests for orchestrator-specific UI state management.
 * Verifies that orchestrator bridge events (phase, verdict, plan, slot)
 * are correctly reduced into UI state.
 */
import { describe, test, expect } from "bun:test";
import { reduceUiState, initialUiState } from "../../src/ui/store-reducer.ts";
import type { UiAction, UiState } from "../../src/ui/store-reducer.ts";

function apply(actions: UiAction[]): UiState {
  return actions.reduce(reduceUiState, initialUiState);
}

describe("store-reducer orchestrator actions", () => {
  describe("orchestrator_phase", () => {
    test("sets loopPhase and loopId", () => {
      const state = apply([{ kind: "orchestrator_phase", loopId: "loop_1", phase: "generating" }]);
      expect(state.loopPhase).toBe("generating");
      expect(state.loopId).toBe("loop_1");
    });

    test("clears verdicts on new loopId", () => {
      let state = apply([
        { kind: "orchestrator_phase", loopId: "loop_1", phase: "generating" },
        { kind: "orchestrator_verdict", loopId: "loop_1", checkpoint: "cp1", verdictAction: "proceed" },
        { kind: "orchestrator_phase", loopId: "loop_2", phase: "generating" },
      ]);
      expect(state.loopVerdicts).toHaveLength(0);
      expect(state.loopId).toBe("loop_2");
    });

    test("preserves verdicts on same loopId", () => {
      let state = apply([
        { kind: "orchestrator_phase", loopId: "loop_1", phase: "generating" },
        { kind: "orchestrator_verdict", loopId: "loop_1", checkpoint: "cp1", verdictAction: "proceed" },
        { kind: "orchestrator_phase", loopId: "loop_1", phase: "evaluating" },
      ]);
      expect(state.loopVerdicts).toHaveLength(1);
    });

    test("sets mood to working for active phases", () => {
      const gen = apply([{ kind: "orchestrator_phase", loopId: "l", phase: "generating" }]);
      expect(gen.mood).toBe("working");

      const eval_ = apply([{ kind: "orchestrator_phase", loopId: "l", phase: "evaluating" }]);
      expect(eval_.mood).toBe("working");
    });

    test("does not set working mood for terminal phases", () => {
      const completed = apply([{ kind: "orchestrator_phase", loopId: "l", phase: "completed" }]);
      expect(completed.mood).toBe("idle");

      const terminated = apply([{ kind: "orchestrator_phase", loopId: "l", phase: "terminated" }]);
      expect(terminated.mood).toBe("idle");
    });
  });

  describe("orchestrator_verdict", () => {
    test("appends verdict to loopVerdicts", () => {
      const state = apply([
        { kind: "orchestrator_verdict", loopId: "l", checkpoint: "plan_ready", verdictAction: "proceed" },
      ]);
      expect(state.loopVerdicts).toHaveLength(1);
      expect(state.loopVerdicts[0].checkpoint).toBe("plan_ready");
      expect(state.loopVerdicts[0].action).toBe("proceed");
    });

    test("injects system turn into transcript", () => {
      const state = apply([
        { kind: "orchestrator_verdict", loopId: "l", checkpoint: "code_review", verdictAction: "retry", detail: "Missing tests" },
      ]);
      const orchTurns = state.turns.filter((t) => t.meta?.orchestrator);
      expect(orchTurns).toHaveLength(1);
      expect(orchTurns[0].kind).toBe("system");
      expect(orchTurns[0].text).toContain("code_review");
      expect(orchTurns[0].text).toContain("retry");
      expect(orchTurns[0].text).toContain("Missing tests");
      expect(orchTurns[0].meta?.subtype).toBe("verdict");
    });

    test("verdict without detail omits colon", () => {
      const state = apply([
        { kind: "orchestrator_verdict", loopId: "l", checkpoint: "cp", verdictAction: "proceed" },
      ]);
      const turn = state.turns.find((t) => t.meta?.orchestrator);
      expect(turn?.text).toBe("cp proceed");
    });

    test("multiple verdicts accumulate", () => {
      const state = apply([
        { kind: "orchestrator_verdict", loopId: "l", checkpoint: "cp1", verdictAction: "proceed" },
        { kind: "orchestrator_verdict", loopId: "l", checkpoint: "cp2", verdictAction: "retry", detail: "fix" },
        { kind: "orchestrator_verdict", loopId: "l", checkpoint: "cp2", verdictAction: "proceed" },
      ]);
      expect(state.loopVerdicts).toHaveLength(3);
      expect(state.turns.filter((t) => t.meta?.orchestrator)).toHaveLength(3);
    });
  });

  describe("orchestrator_plan_event", () => {
    test("sets planStatus on create", () => {
      const state = apply([
        { kind: "orchestrator_plan_event", planAction: "created", path: "/plans/current.md", title: "Feature plan" },
      ]);
      expect(state.planStatus).toEqual({ path: "/plans/current.md", title: "Feature plan", status: "created" });
    });

    test("updates planStatus on accept", () => {
      const state = apply([
        { kind: "orchestrator_plan_event", planAction: "created", path: "/plans/current.md", title: "My plan" },
        { kind: "orchestrator_plan_event", planAction: "accepted", path: "/plans/current.md" },
      ]);
      expect(state.planStatus?.status).toBe("accepted");
    });

    test("injects system turn for plan created with title", () => {
      const state = apply([
        { kind: "orchestrator_plan_event", planAction: "created", path: "/p.md", title: "Build auth" },
      ]);
      const turn = state.turns.find((t) => t.meta?.orchestrator);
      expect(turn?.text).toBe("Plan created: Build auth");
      expect(turn?.meta?.subtype).toBe("plan");
    });

    test("injects system turn for plan accepted", () => {
      const state = apply([
        { kind: "orchestrator_plan_event", planAction: "accepted", path: "/p.md" },
      ]);
      const turn = state.turns.find((t) => t.meta?.orchestrator);
      expect(turn?.text).toBe("Plan accepted");
    });
  });

  describe("orchestrator_slot_switch", () => {
    test("sets foregroundAgent", () => {
      const state = apply([
        { kind: "orchestrator_slot_switch", promoted: "codegen", demoted: "" },
      ]);
      expect(state.foregroundAgent).toBe("codegen");
    });

    test("clears foregroundAgent on empty promoted", () => {
      const state = apply([
        { kind: "orchestrator_slot_switch", promoted: "codegen", demoted: "" },
        { kind: "orchestrator_slot_switch", promoted: "", demoted: "codegen" },
      ]);
      expect(state.foregroundAgent).toBeNull();
    });
  });

  describe("initialUiState", () => {
    test("orchestrator fields start null/empty", () => {
      expect(initialUiState.loopPhase).toBeNull();
      expect(initialUiState.loopId).toBeNull();
      expect(initialUiState.loopVerdicts).toEqual([]);
      expect(initialUiState.foregroundAgent).toBeNull();
      expect(initialUiState.planStatus).toBeNull();
    });
  });

  describe("session_reset clears orchestrator state", () => {
    test("resets all orchestrator fields", () => {
      const state = apply([
        { kind: "orchestrator_phase", loopId: "l", phase: "generating" },
        { kind: "orchestrator_verdict", loopId: "l", checkpoint: "cp", verdictAction: "proceed" },
        { kind: "orchestrator_plan_event", planAction: "created", path: "/p", title: "x" },
        { kind: "orchestrator_slot_switch", promoted: "gen", demoted: "" },
        { kind: "session_reset" },
      ]);
      expect(state.loopPhase).toBeNull();
      expect(state.loopId).toBeNull();
      expect(state.loopVerdicts).toEqual([]);
      expect(state.foregroundAgent).toBeNull();
      expect(state.planStatus).toBeNull();
    });
  });
});
