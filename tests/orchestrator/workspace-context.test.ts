import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  discoverWorkspaceContext,
  formatContextForPrompt,
  type WorkspaceContext,
} from "../../src/orchestrator/workspace-context.ts";

let tmp: string;
beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), "ws-ctx-")); });
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

async function writeJson(rel: string, data: unknown): Promise<void> {
  await writeFile(join(tmp, rel), JSON.stringify(data));
}

describe("discoverWorkspaceContext", () => {
  test("empty directory returns all nulls with valid promptBlock", async () => {
    const ctx = await discoverWorkspaceContext(tmp);
    expect(ctx.packageManager).toBeNull();
    expect(ctx.language).toBeNull();
    expect(ctx.framework).toBeNull();
    expect(ctx.buildCommand).toBeNull();
    expect(ctx.testCommand).toBeNull();
    expect(ctx.lintCommand).toBeNull();
    expect(ctx.typecheckCommand).toBeNull();
    expect(ctx.srcDirs).toEqual([]);
    expect(ctx.testDirs).toEqual([]);
    expect(ctx.promptBlock).toContain("## Project Environment");
    expect(ctx.promptBlock).toContain("No project configuration detected");
  });

  test("TypeScript + bun project", async () => {
    await writeJson("package.json", {
      scripts: { build: "bun build src/index.ts", test: "bun test" },
      dependencies: { zod: "^3.0.0" },
    });
    await writeFile(join(tmp, "bun.lock"), "lockfile-v1");
    await writeFile(join(tmp, "tsconfig.json"), "{}");
    await mkdir(join(tmp, "src"));
    await mkdir(join(tmp, "tests"));
    const ctx = await discoverWorkspaceContext(tmp);
    expect(ctx.packageManager).toBe("bun");
    expect(ctx.language).toBe("typescript");
    expect(ctx.buildCommand).toBe("bun build src/index.ts");
    expect(ctx.testCommand).toBe("bun test");
    expect(ctx.typecheckCommand).toBe("tsc --noEmit");
    expect(ctx.srcDirs).toEqual(["src"]);
    expect(ctx.testDirs).toEqual(["tests"]);
    expect(ctx.promptBlock).toContain("Bun runtime");
  });

  test("Node.js project with package-lock.json, no tsconfig", async () => {
    await writeJson("package.json", {
      scripts: { build: "webpack", test: "jest", lint: "eslint ." },
      dependencies: { express: "^4.0.0" },
    });
    await writeFile(join(tmp, "package-lock.json"), "{}");
    await mkdir(join(tmp, "lib"));
    await mkdir(join(tmp, "test"));
    const ctx = await discoverWorkspaceContext(tmp);
    expect(ctx.packageManager).toBe("npm");
    expect(ctx.language).toBe("javascript");
    expect(ctx.framework).toBe("Express");
    expect(ctx.buildCommand).toBe("webpack");
    expect(ctx.testCommand).toBe("jest");
    expect(ctx.lintCommand).toBe("eslint .");
    expect(ctx.typecheckCommand).toBeNull();
    expect(ctx.srcDirs).toEqual(["lib"]);
    expect(ctx.testDirs).toEqual(["test"]);
  });

  test("detects pnpm from pnpm-lock.yaml", async () => {
    await writeJson("package.json", { scripts: {} });
    await writeFile(join(tmp, "pnpm-lock.yaml"), "lockfileVersion: 9");
    expect((await discoverWorkspaceContext(tmp)).packageManager).toBe("pnpm");
  });

  test("detects yarn from yarn.lock", async () => {
    await writeJson("package.json", { scripts: {} });
    await writeFile(join(tmp, "yarn.lock"), "# yarn lockfile v1");
    expect((await discoverWorkspaceContext(tmp)).packageManager).toBe("yarn");
  });

  test("falls back to npm when only package.json exists", async () => {
    await writeJson("package.json", { scripts: {} });
    expect((await discoverWorkspaceContext(tmp)).packageManager).toBe("npm");
  });

  test("detects Python project", async () => {
    await writeFile(join(tmp, "pyproject.toml"), "[project]\nname = 'app'");
    const ctx = await discoverWorkspaceContext(tmp);
    expect(ctx.language).toBe("python");
    expect(ctx.packageManager).toBeNull();
  });

  test("detects Go project", async () => {
    await writeFile(join(tmp, "go.mod"), "module example.com/app");
    expect((await discoverWorkspaceContext(tmp)).language).toBe("go");
  });

  test("detects Rust project", async () => {
    await writeFile(join(tmp, "Cargo.toml"), "[package]\nname = 'app'");
    expect((await discoverWorkspaceContext(tmp)).language).toBe("rust");
  });

  test("detects alternate script names: test:unit, compile, lint:fix, typecheck", async () => {
    await writeJson("package.json", {
      scripts: {
        "test:unit": "vitest run", compile: "tsc",
        "lint:fix": "biome check --fix .", typecheck: "tsc --noEmit",
      },
    });
    const ctx = await discoverWorkspaceContext(tmp);
    expect(ctx.testCommand).toBe("vitest run");
    expect(ctx.buildCommand).toBe("tsc");
    expect(ctx.lintCommand).toBe("biome check --fix .");
    expect(ctx.typecheckCommand).toBe("tsc --noEmit");
  });

  test("framework detection from dependencies", async () => {
    const cases: [Record<string, string>, string][] = [
      [{ next: "^14.0.0" }, "Next.js"], [{ fastify: "^4.0.0" }, "Fastify"],
      [{ "@nestjs/core": "^10.0.0" }, "NestJS"], [{ vue: "^3.0.0" }, "Vue"],
    ];
    for (const [deps, expected] of cases) {
      const dir = await mkdtemp(join(tmpdir(), "fw-"));
      await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: deps }));
      expect((await discoverWorkspaceContext(dir)).framework).toBe(expected);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("lint fallback to biome.json when no script", async () => {
    await writeJson("package.json", { scripts: {} });
    await writeFile(join(tmp, "biome.json"), "{}");
    expect((await discoverWorkspaceContext(tmp)).lintCommand).toBe("biome check .");
  });

  test("lint fallback to eslint config when no script", async () => {
    await writeJson("package.json", { scripts: {} });
    await writeFile(join(tmp, "eslint.config.js"), "export default {};");
    expect((await discoverWorkspaceContext(tmp)).lintCommand).toBe("eslint .");
  });

  test("typecheck fallback: pyright for python", async () => {
    await writeFile(join(tmp, "pyproject.toml"), "[project]");
    await writeFile(join(tmp, "pyrightconfig.json"), "{}");
    expect((await discoverWorkspaceContext(tmp)).typecheckCommand).toBe("pyright");
  });

  test("discovers multiple src and test directories", async () => {
    for (const d of ["src", "lib", "app", "tests", "__tests__"]) await mkdir(join(tmp, d));
    const ctx = await discoverWorkspaceContext(tmp);
    expect(ctx.srcDirs).toEqual(["src", "lib", "app"]);
    expect(ctx.testDirs).toEqual(["tests", "__tests__"]);
  });
});

describe("formatContextForPrompt", () => {
  const full: WorkspaceContext = {
    packageManager: "bun", language: "typescript", framework: "Next.js",
    buildCommand: "next build", testCommand: "bun test",
    lintCommand: "biome check .", typecheckCommand: "tsc --noEmit",
    srcDirs: ["src", "app"], testDirs: ["tests"], promptBlock: "",
  };
  const empty: WorkspaceContext = {
    packageManager: null, language: null, framework: null,
    buildCommand: null, testCommand: null, lintCommand: null, typecheckCommand: null,
    srcDirs: [], testDirs: [], promptBlock: "",
  };

  test("includes all populated fields", () => {
    const block = formatContextForPrompt(full);
    expect(block).toContain("## Project Environment");
    expect(block).toContain("Language: typescript (Bun runtime)");
    expect(block).toContain("Framework: Next.js");
    expect(block).toContain("Package manager: bun");
    expect(block).toContain("Build: `next build`");
    expect(block).toContain("Test: `bun test`");
    expect(block).toContain("Lint: `biome check .`");
    expect(block).toContain("Typecheck: `tsc --noEmit`");
    expect(block).toContain("Source: src, app/");
    expect(block).toContain("Tests: tests/");
  });

  test("omits null fields without crashing", () => {
    const block = formatContextForPrompt(empty);
    expect(block).toContain("## Project Environment");
    expect(block).toContain("No project configuration detected");
    expect(block).not.toContain("Language:");
    expect(block).not.toContain("Build:");
  });
});
