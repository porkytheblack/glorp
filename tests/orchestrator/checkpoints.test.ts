import { describe, test, expect } from "bun:test";
import {
  PLAN_READY,
  FEATURE_COMPLETE,
  ITERATION_DONE,
  makeCheckpoint,
  formatCriteriaBlock,
  parseVerdict,
} from "../../src/orchestrator/checkpoints.ts";

describe("built-in checkpoints", () => {
  test("PLAN_READY shape", () => {
    expect(PLAN_READY.name).toBe("plan_ready");
    expect(PLAN_READY.criteria.length).toBeGreaterThan(0);
    expect(PLAN_READY.description).toBeTruthy();
  });

  test("FEATURE_COMPLETE shape", () => {
    expect(FEATURE_COMPLETE.name).toBe("feature_complete");
    expect(FEATURE_COMPLETE.criteria.length).toBeGreaterThan(0);
  });

  test("ITERATION_DONE shape", () => {
    expect(ITERATION_DONE.name).toBe("iteration_done");
    expect(ITERATION_DONE.criteria.length).toBeGreaterThan(0);
  });
});

describe("makeCheckpoint", () => {
  test("returns checkpoint with provided fields", () => {
    const cp = makeCheckpoint("test_cp", "A test", ["A", "B"]);
    expect(cp).toEqual({ name: "test_cp", description: "A test", criteria: ["A", "B"] });
  });
});

describe("formatCriteriaBlock", () => {
  test("formats checkpoint into markdown", () => {
    const cp = makeCheckpoint("my_check", "Check desc", ["First", "Second"]);
    const block = formatCriteriaBlock(cp);
    expect(block).toContain("## Checkpoint: my_check");
    expect(block).toContain("Check desc");
    expect(block).toContain("  - First");
    expect(block).toContain("  - Second");
  });

  test("single criterion", () => {
    const block = formatCriteriaBlock(makeCheckpoint("x", "y", ["Only"]));
    expect(block).toContain("  - Only");
    expect(block).toContain("Criteria:");
  });
});

describe("parseVerdict", () => {
  describe("valid JSON", () => {
    test("proceed with note", () => {
      const v = parseVerdict('{ "action": "proceed", "note": "LGTM" }');
      expect(v).toEqual({ action: "proceed", note: "LGTM" });
    });

    test("proceed without note", () => {
      const v = parseVerdict('{ "action": "proceed" }');
      expect(v.action).toBe("proceed");
      expect((v as any).note).toBeUndefined();
    });

    test("retry with feedback", () => {
      const v = parseVerdict('{ "action": "retry", "feedback": "fix bug" }');
      expect(v).toEqual({ action: "retry", feedback: "fix bug" });
    });

    test("retry with maxRetries", () => {
      const v = parseVerdict('{ "action": "retry", "feedback": "x", "maxRetries": 5 }');
      expect(v).toHaveProperty("maxRetries", 5);
    });

    test("retry missing feedback uses default", () => {
      const v = parseVerdict('{ "action": "retry" }');
      expect(v.action).toBe("retry");
      expect((v as any).feedback).toBe("No specific feedback provided.");
    });

    test("terminate with reason", () => {
      const v = parseVerdict('{ "action": "terminate", "reason": "impossible" }');
      expect(v).toEqual({ action: "terminate", reason: "impossible" });
    });

    test("terminate missing reason uses default", () => {
      const v = parseVerdict('{ "action": "terminate" }');
      expect((v as any).reason).toBe("Evaluator terminated the loop.");
    });
  });

  describe("JSON embedded in prose", () => {
    test("extracts from surrounding text", () => {
      const v = parseVerdict('Sure! { "action": "proceed", "note": "ok" } Done.');
      expect(v).toEqual({ action: "proceed", note: "ok" });
    });
  });

  describe("case insensitivity", () => {
    test("action field normalised to lowercase", () => {
      expect(parseVerdict('{ "action": "PROCEED" }').action).toBe("proceed");
      expect(parseVerdict('{ "action": "Retry", "feedback": "x" }').action).toBe("retry");
      expect(parseVerdict('{ "action": "TERMINATE", "reason": "x" }').action).toBe("terminate");
    });
  });

  describe("unknown action falls through", () => {
    test("unknown action infers from text", () => {
      const v = parseVerdict('{ "action": "yolo" }');
      expect(v.action).toBe("retry"); // no keyword match → retry
    });
  });

  describe("malformed JSON", () => {
    test("invalid JSON with keyword infers", () => {
      expect(parseVerdict("{ action: proceed }").action).toBe("proceed");
    });
  });

  describe("text inference (no JSON)", () => {
    test.each([
      ["approved", "proceed"],
      ["accepted", "proceed"],
      ["proceed to next", "proceed"],
      ["terminate now", "terminate"],
      ["reject this", "terminate"],
      ["abort process", "terminate"],
    ] as const)("'%s' → %s", (text, expected) => {
      expect(parseVerdict(text).action).toBe(expected);
    });

    test("unrecognised text → retry", () => {
      const v = parseVerdict("needs more work on error handling");
      expect(v.action).toBe("retry");
      expect((v as any).feedback).toBeTruthy();
    });

    test("empty string → retry", () => {
      expect(parseVerdict("").action).toBe("retry");
    });
  });

  describe("truncation", () => {
    test("long text inference truncates feedback", () => {
      const long = "x".repeat(1000);
      const v = parseVerdict(long);
      expect(v.action).toBe("retry");
      expect((v as any).feedback.length).toBeLessThanOrEqual(500);
    });
  });
});
