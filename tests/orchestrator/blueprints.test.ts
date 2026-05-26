import { describe, test, expect } from "bun:test";
import {
  generatorBlueprint,
  evaluatorBlueprint,
  researchBlueprint,
  builderBlueprint,
} from "../../src/orchestrator/blueprints.ts";

const WORKSPACE = "/tmp/test-workspace";

describe("blueprint factories", () => {
  describe("generatorBlueprint", () => {
    test("returns generator role", () => {
      const bp = generatorBlueprint({ workspace: WORKSPACE });
      expect(bp.role).toBe("generator");
      expect(bp.label).toBe("Generator");
    });

    test("id contains role name", () => {
      const bp = generatorBlueprint({ workspace: WORKSPACE });
      expect(bp.id).toContain("generator");
    });

    test("id uses suffix when provided", () => {
      const bp = generatorBlueprint({ workspace: WORKSPACE, idSuffix: "abc" });
      expect(bp.id).toContain("abc");
    });

    test("has write tools", () => {
      const bp = generatorBlueprint({ workspace: WORKSPACE });
      expect(bp.tools).toContain("write");
      expect(bp.tools).toContain("bash");
    });

    test("has non-empty systemPrompt", () => {
      const bp = generatorBlueprint({ workspace: WORKSPACE });
      expect(bp.systemPrompt.length).toBeGreaterThan(10);
    });

    test("has capabilities from registry", () => {
      const bp = generatorBlueprint({ workspace: WORKSPACE });
      expect(bp.capabilities!.length).toBeGreaterThan(0);
    });
  });

  describe("evaluatorBlueprint", () => {
    test("returns evaluator role", () => {
      const bp = evaluatorBlueprint({ workspace: WORKSPACE });
      expect(bp.role).toBe("evaluator");
      expect(bp.label).toBe("Evaluator");
    });

    test("read-only tools", () => {
      const bp = evaluatorBlueprint({ workspace: WORKSPACE });
      expect(bp.tools).toContain("read");
      expect(bp.tools).not.toContain("write");
    });
  });

  describe("researchBlueprint", () => {
    test("returns autonomous role", () => {
      const bp = researchBlueprint({ workspace: WORKSPACE });
      expect(bp.role).toBe("autonomous");
    });

    test("has web_fetch tool", () => {
      const bp = researchBlueprint({ workspace: WORKSPACE });
      expect(bp.tools).toContain("web_fetch");
    });
  });

  describe("builderBlueprint", () => {
    test("returns autonomous role", () => {
      const bp = builderBlueprint({ workspace: WORKSPACE });
      expect(bp.role).toBe("autonomous");
    });

    test("has write tools", () => {
      const bp = builderBlueprint({ workspace: WORKSPACE });
      expect(bp.tools).toContain("write");
      expect(bp.tools).toContain("edit");
    });
  });

  describe("cross-cutting", () => {
    test("all blueprints have unique ids", () => {
      const ids = [
        generatorBlueprint({ workspace: WORKSPACE }),
        evaluatorBlueprint({ workspace: WORKSPACE }),
        researchBlueprint({ workspace: WORKSPACE }),
        builderBlueprint({ workspace: WORKSPACE }),
      ].map((bp) => bp.id);

      expect(new Set(ids).size).toBe(4);
    });

    test("tools arrays are mutable copies", () => {
      const bp1 = generatorBlueprint({ workspace: WORKSPACE });
      const bp2 = generatorBlueprint({ workspace: WORKSPACE });
      bp1.tools.push("extra");
      expect(bp2.tools).not.toContain("extra");
    });
  });
});
