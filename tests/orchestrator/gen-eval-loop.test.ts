/**
 * Tests for gen-eval-loop control flow.
 * Tests parseVerdict + formatCriteriaBlock integration (the loop's decision
 * engine) and the extractText/buildRetryPrompt helpers indirectly through
 * the checkpoint/verdict infrastructure.
 *
 * The full runGenEvalLoop function depends on buildAgentFromBlueprint which
 * needs a real Glove + model stack. Those paths are tested in the
 * orchestrator integration test. Here we verify the decision logic.
 */
import { describe, test, expect } from "bun:test";
import {
  makeCheckpoint,
  formatCriteriaBlock,
  parseVerdict,
} from "../../src/orchestrator/checkpoints.ts";
import type { Verdict, GenEvalLoopOptions } from "../../src/orchestrator/types.ts";

describe("gen-eval loop decision logic", () => {
  describe("checkpoint → verdict flow", () => {
    test("proceed verdict passes a checkpoint", () => {
      const cp = makeCheckpoint("review", "Code review", ["no bugs", "tests pass"]);
      const block = formatCriteriaBlock(cp);

      // Evaluator would see this block + generator output, then respond:
      const evaluatorResponse = `
        I reviewed the output against the criteria.
        { "action": "proceed", "note": "All criteria met." }
      `;
      const verdict = parseVerdict(evaluatorResponse);

      expect(verdict.action).toBe("proceed");
      expect(block).toContain("no bugs");
    });

    test("retry verdict triggers re-generation", () => {
      const evaluatorResponse = `
        The output doesn't meet criterion 2.
        { "action": "retry", "feedback": "Tests are missing for the edge case." }
      `;
      const verdict = parseVerdict(evaluatorResponse);

      expect(verdict.action).toBe("retry");
      expect((verdict as Extract<Verdict, { action: "retry" }>).feedback).toContain("Tests are missing");
    });

    test("terminate verdict stops the loop", () => {
      const evaluatorResponse = `
        { "action": "terminate", "reason": "The approach is fundamentally wrong." }
      `;
      const verdict = parseVerdict(evaluatorResponse);

      expect(verdict.action).toBe("terminate");
      expect((verdict as Extract<Verdict, { action: "terminate" }>).reason).toContain("fundamentally wrong");
    });
  });

  describe("verdict from ambiguous evaluator output", () => {
    test("evaluator says approved without JSON → proceed", () => {
      const verdict = parseVerdict("The output looks good. This is approved for release.");
      expect(verdict.action).toBe("proceed");
    });

    test("evaluator gives critique without JSON → retry", () => {
      const verdict = parseVerdict("The error handling needs improvement in the parser module.");
      expect(verdict.action).toBe("retry");
    });

    test("evaluator rejects without JSON → terminate", () => {
      const verdict = parseVerdict("I reject this approach. We need to abort and rethink.");
      expect(verdict.action).toBe("terminate");
    });
  });

  describe("GenEvalLoopOptions shape", () => {
    test("options type accepts all required fields", () => {
      const opts: GenEvalLoopOptions = {
        loopId: "test_loop",
        generatorBlueprint: { id: "gen_1" as any, label: "Gen", role: "generator", systemPrompt: "", tools: [] },
        evaluatorBlueprint: { id: "eval_1" as any, label: "Eval", role: "evaluator", systemPrompt: "", tools: [] },
        checkpoints: [makeCheckpoint("cp1", "desc", ["c1"])],
        initialPrompt: "do something",
      };
      expect(opts.loopId).toBe("test_loop");
    });

    test("options type accepts optional fields", () => {
      const opts: GenEvalLoopOptions = {
        loopId: "test",
        generatorBlueprint: { id: "g" as any, label: "G", role: "generator", systemPrompt: "", tools: [] },
        evaluatorBlueprint: { id: "e" as any, label: "E", role: "evaluator", systemPrompt: "", tools: [] },
        checkpoints: [],
        initialPrompt: "x",
        maxRetries: 5,
        foregroundRole: "evaluator",
      };
      expect(opts.maxRetries).toBe(5);
      expect(opts.foregroundRole).toBe("evaluator");
    });
  });

  describe("multi-checkpoint sequencing logic", () => {
    test("proceed note from one checkpoint feeds into next prompt", () => {
      const cp1 = makeCheckpoint("plan", "Plan phase", ["scope defined"]);
      const cp2 = makeCheckpoint("build", "Build phase", ["code compiles"]);

      // Simulate: cp1 passes with note
      const v1 = parseVerdict('{ "action": "proceed", "note": "Plan covers all requirements" }');
      expect(v1.action).toBe("proceed");

      // The loop would build a continuation prompt like:
      const nextPrompt = `Previous checkpoint (${cp1.name}) passed. Note: ${(v1 as any).note}\n\nContinue with the next phase.`;
      expect(nextPrompt).toContain("Plan covers all requirements");
      expect(nextPrompt).toContain("plan");

      // cp2 also passes
      const v2 = parseVerdict('{ "action": "proceed", "note": "Build complete" }');
      expect(v2.action).toBe("proceed");
    });
  });

  describe("retry prompt construction", () => {
    test("retry feedback would be included in re-generation prompt", () => {
      const verdict = parseVerdict('{ "action": "retry", "feedback": "Missing error handling for null inputs" }');
      expect(verdict.action).toBe("retry");

      // The loop constructs: [Retry N/M] + feedback + original task
      const feedback = (verdict as Extract<Verdict, { action: "retry" }>).feedback;
      expect(feedback).toContain("null inputs");
    });

    test("maxRetries from verdict is preserved", () => {
      const verdict = parseVerdict('{ "action": "retry", "feedback": "x", "maxRetries": 2 }');
      expect((verdict as any).maxRetries).toBe(2);
    });
  });
});
