import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import * as os from "node:os";

import { readTool } from "../src/agent/tools/read.ts";
import { writeTool } from "../src/agent/tools/write.ts";
import { editTool } from "../src/agent/tools/edit.ts";
import { applyPatchTool } from "../src/agent/tools/apply-patch.ts";
import { planTool } from "../src/agent/tools/plan.ts";
import { bashTool } from "../src/agent/tools/bash.ts";
import { globTool } from "../src/agent/tools/glob.ts";
import { grepTool } from "../src/agent/tools/grep.ts";
import { lsTool } from "../src/agent/tools/ls.ts";
import { webFetchTool } from "../src/agent/tools/webfetch.ts";
import { transmissionTool } from "../src/agent/tools/transmission.ts";
import { resolveSafePath, globToRegex, expandBraces } from "../src/agent/tools/fs-shared.ts";
import { GlorpStore } from "../src/agent/store.ts";
import { FileResourcesAdapter } from "../src/agent/resources/file-adapter.ts";
import { createGlorpMemorySchema } from "../src/agent/resources/schema.ts";
import { getBridge } from "../src/shared/bridge.ts";

// Stubs for tool `do` extra args we never exercise in unit tests.
const display: any = {};
const glove: any = {};

let workspace: string;
let dataDir: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-ws-"));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-data-"));
});

afterEach(() => {
  try {
    fs.rmSync(workspace, { recursive: true, force: true });
  } catch {}
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {}
});

// =====================================================================
// resolveSafePath
// =====================================================================
describe("resolveSafePath", () => {
  test("accepts simple relative path", () => {
    const abs = resolveSafePath(workspace, "foo.txt");
    expect(abs).toBe(path.join(workspace, "foo.txt"));
  });

  test("accepts nested relative path", () => {
    const abs = resolveSafePath(workspace, "a/b/c.txt");
    expect(abs).toBe(path.join(workspace, "a", "b", "c.txt"));
  });

  test("accepts absolute path within workspace", () => {
    const target = path.join(workspace, "deep/inner.txt");
    expect(resolveSafePath(workspace, target)).toBe(target);
  });

  test("refuses ..", () => {
    expect(() => resolveSafePath(workspace, "../escape.txt")).toThrow(/outside the workspace/);
  });

  test("refuses ../../etc/passwd", () => {
    expect(() => resolveSafePath(workspace, "../../etc/passwd")).toThrow(/outside the workspace/);
  });

  test("refuses absolute /etc", () => {
    expect(() => resolveSafePath(workspace, "/etc/passwd")).toThrow(/outside the workspace/);
  });

  test("refuses absolute /foo", () => {
    expect(() => resolveSafePath(workspace, "/foo")).toThrow(/outside the workspace/);
  });

  test("workspace root itself resolves", () => {
    expect(resolveSafePath(workspace, ".")).toBe(path.resolve(workspace));
  });
});

// =====================================================================
// globToRegex / expandBraces
// =====================================================================
describe("globToRegex", () => {
  test("* matches a single level", () => {
    const re = globToRegex("*.ts");
    expect(re.test("foo.ts")).toBe(true);
    expect(re.test("a/foo.ts")).toBe(false);
  });

  test("** matches across slashes", () => {
    const re = globToRegex("src/**/*.ts");
    expect(re.test("src/a/b.ts")).toBe(true);
    expect(re.test("src/a.ts")).toBe(true);
    expect(re.test("src/a/b/c.ts")).toBe(true);
  });

  test("[abc] character class works", () => {
    const re = globToRegex("file[abc].ts");
    expect(re.test("filea.ts")).toBe(true);
    expect(re.test("fileb.ts")).toBe(true);
    expect(re.test("filez.ts")).toBe(false);
  });

  test("? matches a single char (not slash)", () => {
    const re = globToRegex("f?.ts");
    expect(re.test("fa.ts")).toBe(true);
    expect(re.test("f/.ts")).toBe(false);
  });

  test("dots are escaped (don't match arbitrary chars)", () => {
    const re = globToRegex("*.ts");
    expect(re.test("fooXts")).toBe(false);
  });

  test("**/*.ts matches top-level too", () => {
    const re = globToRegex("**/*.ts");
    expect(re.test("foo.ts")).toBe(true);
    expect(re.test("src/a/foo.ts")).toBe(true);
  });

  test("{a,b} brace expansion works", () => {
    const re = globToRegex("*.{ts,tsx}");
    expect(re.test("foo.ts")).toBe(true);
    expect(re.test("foo.tsx")).toBe(true);
    expect(re.test("foo.js")).toBe(false);
  });

  test("{a,b,c} brace expansion with three alternatives", () => {
    const re = globToRegex("*.{ts,js,py}");
    expect(re.test("a.ts")).toBe(true);
    expect(re.test("a.js")).toBe(true);
    expect(re.test("a.py")).toBe(true);
    expect(re.test("a.rs")).toBe(false);
  });

  test("nested ** + brace", () => {
    const re = globToRegex("src/**/*.{ts,tsx}");
    expect(re.test("src/a/b.ts")).toBe(true);
    expect(re.test("src/a/b.tsx")).toBe(true);
    expect(re.test("src/a/b.js")).toBe(false);
  });

  test("expandBraces returns single-element list when no braces", () => {
    expect(expandBraces("**/*.ts")).toEqual(["**/*.ts"]);
  });

  test("expandBraces expands one group", () => {
    expect(expandBraces("*.{a,b}")).toEqual(["*.a", "*.b"]);
  });
});

// =====================================================================
// read.ts
// =====================================================================
describe("readTool", () => {
  test("reads existing file with line numbers", async () => {
    fs.writeFileSync(path.join(workspace, "a.txt"), "line1\nline2\nline3");
    const tool = readTool(workspace);
    const r = await tool.do({ path: "a.txt" }, display, glove);
    expect(r.status).toBe("success");
    expect(r.data as string).toContain("    1→line1");
    expect(r.data as string).toContain("    2→line2");
    expect(r.data as string).toContain("    3→line3");
  });

  test("provides a compact summary for older read results", async () => {
    fs.writeFileSync(path.join(workspace, "a.txt"), "line1\nline2\nline3");
    const tool = readTool(workspace);
    const r = await tool.do({ path: "a.txt", offset: 2, limit: 1 }, display, glove);
    const summary = await tool.generateToolSummary?.(r.generateSummaryArgs);
    expect(summary).toContain("Read a.txt");
    expect(summary).toContain("lines 2-2");
    expect(summary).toContain("Full prior contents omitted");
    expect(summary).not.toContain("line2");
  });

  test("returns error for nonexistent file", async () => {
    const tool = readTool(workspace);
    const r = await tool.do({ path: "nope.txt" }, display, glove);
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/Not a file/);
  });

  test("returns error for directory", async () => {
    fs.mkdirSync(path.join(workspace, "subdir"));
    const tool = readTool(workspace);
    const r = await tool.do({ path: "subdir" }, display, glove);
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/Not a file/);
  });

  test(">1MB file is truncated", async () => {
    const big = "x".repeat(1024 * 1024 + 100);
    fs.writeFileSync(path.join(workspace, "big.txt"), big);
    const tool = readTool(workspace);
    const r = await tool.do({ path: "big.txt" }, display, glove);
    expect(r.status).toBe("success");
    expect(r.data as string).toContain("[truncated, file is");
  });

  test("empty file is handled", async () => {
    fs.writeFileSync(path.join(workspace, "empty.txt"), "");
    const tool = readTool(workspace);
    const r = await tool.do({ path: "empty.txt" }, display, glove);
    expect(r.status).toBe("success");
    expect(r.data as string).toContain("    1→");
  });

  test("offset=2 limit=2 reads lines 2 and 3", async () => {
    fs.writeFileSync(path.join(workspace, "x.txt"), "a\nb\nc\nd\ne");
    const tool = readTool(workspace);
    const r = await tool.do({ path: "x.txt", offset: 2, limit: 2 }, display, glove);
    expect(r.status).toBe("success");
    const data = r.data as string;
    expect(data).toContain("    2→b");
    expect(data).toContain("    3→c");
    expect(data).not.toContain("    4→d");
    expect(data).toContain("[2 more lines");
  });

  test("offset=1 limit=1 reads first line only", async () => {
    fs.writeFileSync(path.join(workspace, "x.txt"), "first\nsecond");
    const tool = readTool(workspace);
    const r = await tool.do({ path: "x.txt", offset: 1, limit: 1 }, display, glove);
    expect(r.status).toBe("success");
    const data = r.data as string;
    expect(data).toContain("    1→first");
    expect(data).not.toContain("second");
  });

  test("offset beyond EOF returns empty slice", async () => {
    fs.writeFileSync(path.join(workspace, "x.txt"), "only-line");
    const tool = readTool(workspace);
    const r = await tool.do({ path: "x.txt", offset: 999 }, display, glove);
    expect(r.status).toBe("success");
    expect(r.data as string).toBe("");
  });

  test("refuses path outside workspace", async () => {
    const tool = readTool(workspace);
    await expect(tool.do({ path: "../escape.txt" }, display, glove)).rejects.toThrow(
      /outside the workspace/,
    );
  });
});

// =====================================================================
// write.ts
// =====================================================================
describe("writeTool", () => {
  test("writes new file in nested dir (mkdir -p)", async () => {
    const tool = writeTool(workspace);
    const r = await tool.do({ path: "a/b/c/file.txt", content: "hello\nworld" }, display, glove);
    expect(r.status).toBe("success");
    expect(fs.existsSync(path.join(workspace, "a/b/c/file.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(workspace, "a/b/c/file.txt"), "utf-8")).toBe("hello\nworld");
    expect(r.data as string).toMatch(/Created/);
  });

  test("overwrites existing file", async () => {
    fs.writeFileSync(path.join(workspace, "old.txt"), "old");
    const tool = writeTool(workspace);
    const r = await tool.do({ path: "old.txt", content: "new" }, display, glove);
    expect(r.status).toBe("success");
    expect(r.data as string).toMatch(/Overwrote/);
    expect(fs.readFileSync(path.join(workspace, "old.txt"), "utf-8")).toBe("new");
  });

  test("refuses path outside workspace", async () => {
    const tool = writeTool(workspace);
    await expect(tool.do({ path: "../escape.txt", content: "x" }, display, glove)).rejects.toThrow(
      /outside the workspace/,
    );
  });
});

// =====================================================================
// edit.ts
// =====================================================================
describe("editTool", () => {
  test("unique substring replace", async () => {
    fs.writeFileSync(path.join(workspace, "f.txt"), "hello world");
    const tool = editTool(workspace);
    const r = await tool.do(
      { path: "f.txt", old_string: "world", new_string: "friend" },
      display,
      glove,
    );
    expect(r.status).toBe("success");
    expect(fs.readFileSync(path.join(workspace, "f.txt"), "utf-8")).toBe("hello friend");
  });

  test("replace_all multi-match", async () => {
    fs.writeFileSync(path.join(workspace, "f.txt"), "x x x");
    const tool = editTool(workspace);
    const r = await tool.do(
      { path: "f.txt", old_string: "x", new_string: "y", replace_all: true },
      display,
      glove,
    );
    expect(r.status).toBe("success");
    expect(fs.readFileSync(path.join(workspace, "f.txt"), "utf-8")).toBe("y y y");
  });

  test("old_string not found returns error", async () => {
    fs.writeFileSync(path.join(workspace, "f.txt"), "abc");
    const tool = editTool(workspace);
    const r = await tool.do(
      { path: "f.txt", old_string: "ZZZ", new_string: "yyy" },
      display,
      glove,
    );
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/not found/);
  });

  test("identical old/new returns error", async () => {
    fs.writeFileSync(path.join(workspace, "f.txt"), "abc");
    const tool = editTool(workspace);
    const r = await tool.do(
      { path: "f.txt", old_string: "abc", new_string: "abc" },
      display,
      glove,
    );
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/identical/);
  });

  test("multi-match without replace_all returns error", async () => {
    fs.writeFileSync(path.join(workspace, "f.txt"), "x x x");
    const tool = editTool(workspace);
    const r = await tool.do(
      { path: "f.txt", old_string: "x", new_string: "y" },
      display,
      glove,
    );
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/appears 3 times/);
  });

  test("file doesn't exist returns error", async () => {
    const tool = editTool(workspace);
    const r = await tool.do(
      { path: "nope.txt", old_string: "a", new_string: "b" },
      display,
      glove,
    );
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/Not a file/);
  });
});

// =====================================================================
// apply-patch.ts
// =====================================================================
describe("applyPatchTool", () => {
  test("applies a unified diff patch", async () => {
    fs.writeFileSync(path.join(workspace, "a.txt"), "old\n");
    const patch = [
      "diff --git a/a.txt b/a.txt",
      "index 3367afd..3e75765 100644",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");
    const tool = applyPatchTool(workspace);
    const r = await tool.do({ patch }, display, glove);
    expect(r.status).toBe("success");
    expect(fs.readFileSync(path.join(workspace, "a.txt"), "utf-8")).toBe("new\n");
    expect(r.data as string).toContain("a.txt");
  });

  test("invalid patch leaves file unchanged", async () => {
    fs.writeFileSync(path.join(workspace, "a.txt"), "old\n");
    const tool = applyPatchTool(workspace);
    const r = await tool.do({ patch: "not a diff" }, display, glove);
    expect(r.status).toBe("error");
    expect(fs.readFileSync(path.join(workspace, "a.txt"), "utf-8")).toBe("old\n");
  });

  test("refuses paths outside workspace", async () => {
    const patch = [
      "diff --git a/../escape.txt b/../escape.txt",
      "index 3367afd..3e75765 100644",
      "--- a/../escape.txt",
      "+++ b/../escape.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");
    const tool = applyPatchTool(workspace);
    await expect(tool.do({ patch }, display, glove)).rejects.toThrow(/outside the workspace/);
  });
});

// =====================================================================
// plan.ts
// =====================================================================
describe("planTool", () => {
  test("stores a durable methodology plan separate from tasks", async () => {
    const store = new GlorpStore("plan-tool", dataDir);
    const resources = new FileResourcesAdapter({
      dataDir,
      sessionId: "plan-tool",
      schema: createGlorpMemorySchema(),
    });
    const tool = planTool(store, resources);
    const r = await tool.do(
      {
        title: "Database migration",
        body: "Methodology: inspect migrations, plan rollback, apply schema, verify queries.",
      },
      display,
      glove,
    );
    expect(r.status).toBe("success");
    expect((await store.getPlan())?.title).toBe("Database migration");
    const mirrored = await resources.read("/plans/current.md", { range: [1, -1] });
    expect(mirrored.body).toEqual({
      type: "markdown",
      text: "# Database migration\n\nMethodology: inspect migrations, plan rollback, apply schema, verify queries.",
    });
    expect((await store.getTasks())).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
});

// =====================================================================
// bash.ts
// =====================================================================
describe("bashTool", () => {
  test("exit 0 success", async () => {
    const tool = bashTool(workspace);
    const r = await tool.do({ command: "echo hi", description: "echo hi" }, display, glove);
    expect(r.status).toBe("success");
    expect(r.data as string).toContain("hi");
    expect(r.data as string).toContain("exit_code: 0");
  });

  test("nonzero exit returns error", async () => {
    const tool = bashTool(workspace);
    const r = await tool.do({ command: "exit 7", description: "fail" }, display, glove);
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/exited with code 7/);
  });

  test("timeout hit reports timed-out message", async () => {
    const tool = bashTool(workspace);
    const r = await tool.do(
      { command: "sleep 5", description: "sleep", timeout_ms: 1000 },
      display,
      glove,
    );
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/timed out|exited with code/);
  }, 10_000);

  test("abort via AbortController cancels", async () => {
    const tool = bashTool(workspace);
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 200);
    const t0 = Date.now();
    const r = await tool.do(
      { command: "sleep 5", description: "sleep" },
      display,
      glove,
      ctrl.signal,
    );
    const dt = Date.now() - t0;
    expect(dt).toBeLessThan(3000);
    expect(r.status).toBe("error");
  }, 10_000);

  test("destructive pattern: rm -rf / is refused", async () => {
    const tool = bashTool(workspace);
    const r = await tool.do({ command: "rm -rf /", description: "danger" }, display, glove);
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/destructive pattern/);
  });

  test("destructive pattern: mkfs is refused", async () => {
    const tool = bashTool(workspace);
    const r = await tool.do(
      { command: "mkfs.ext4 /dev/foo", description: "danger" },
      display,
      glove,
    );
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/destructive pattern/);
  });

  test("destructive pattern: fork bomb is refused", async () => {
    const tool = bashTool(workspace);
    const r = await tool.do({ command: ":(){ :|:& };:", description: "danger" }, display, glove);
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/destructive pattern/);
  });

  test("destructive pattern: > /dev/nvme is refused", async () => {
    const tool = bashTool(workspace);
    const r = await tool.do(
      { command: "cat foo > /dev/nvme0n1", description: "danger" },
      display,
      glove,
    );
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/destructive pattern/);
  });

  test("stdout > 256KB is truncated", async () => {
    const tool = bashTool(workspace);
    const r = await tool.do(
      { command: `yes 'aaaaaaaaaaaaaaaaaa' | head -c 300000`, description: "noise" },
      display,
      glove,
    );
    expect(r.status).toBe("success");
    // Per-stream cap of 256KB + small suffix
    expect((r.data as string).length).toBeLessThan(263_000);
    expect(r.data as string).toContain("stdout truncated");
  }, 15_000);

  test("large stdout keeps head and tail with elision marker", async () => {
    const tool = bashTool(workspace);
    const r = await tool.do(
      {
        command:
          "printf 'HEAD-LINE\\n'; yes middle-line | head -n 9000; printf 'TAIL-LINE\\n'",
        description: "print head and tail",
      },
      display,
      glove,
    );
    expect(r.status).toBe("success");
    const out = r.data as string;
    expect(out).toContain("HEAD-LINE");
    expect(out).toContain("TAIL-LINE");
    expect(out).toContain("lines elided");
    expect(out.length).toBeLessThan(80_000);
  }, 15_000);

  test("provides a compact summary for older bash results", async () => {
    const tool = bashTool(workspace);
    const r = await tool.do(
      { command: "printf 'one\\ntwo\\nthree\\n'", description: "print sample lines" },
      display,
      glove,
    );
    const summary = await tool.generateToolSummary?.(r.generateSummaryArgs);
    expect(summary).toContain("Ran: print sample lines");
    expect(summary).toContain("Exit code: 0");
    expect(summary).toContain("stdout preview");
  });

  test("command runs in workspace cwd", async () => {
    const tool = bashTool(workspace);
    const r = await tool.do({ command: "pwd", description: "pwd" }, display, glove);
    expect(r.status).toBe("success");
    expect(r.data as string).toContain(path.basename(workspace));
  });

  test("concurrent bash calls don't interfere", async () => {
    const tool = bashTool(workspace);
    const N = 5;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        tool.do({ command: `echo job-${i}`, description: `job ${i}` }, display, glove),
      ),
    );
    for (let i = 0; i < N; i++) {
      expect(results[i]!.status).toBe("success");
      expect(results[i]!.data as string).toContain(`job-${i}`);
    }
  });

  test("rm -rf /tmp/subdir (non-root) is NOT refused", async () => {
    const tool = bashTool(workspace);
    const subdir = path.join(workspace, "sub");
    fs.mkdirSync(subdir);
    const r = await tool.do({ command: `rm -rf ${subdir}`, description: "rm sub" }, display, glove);
    expect(r.status).toBe("success");
  });
});

// =====================================================================
// glob.ts
// =====================================================================
describe("globTool", () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(workspace, "src/a/b"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "src/a/b/file.ts"), "x");
    fs.writeFileSync(path.join(workspace, "src/a/other.ts"), "x");
    fs.writeFileSync(path.join(workspace, "src/top.ts"), "x");
    fs.writeFileSync(path.join(workspace, "top.txt"), "x");
  });

  test("**/*.ts finds nested files", async () => {
    const tool = globTool(workspace);
    const r = await tool.do({ pattern: "**/*.ts" }, display, glove);
    expect(r.status).toBe("success");
    const lines = (r.data as string).split("\n");
    expect(lines).toContain("src/a/b/file.ts");
    expect(lines).toContain("src/a/other.ts");
    expect(lines).toContain("src/top.ts");
    expect(lines).not.toContain("top.txt");
  });

  test("{a,b} brace expansion finds .ts AND .tsx", async () => {
    fs.writeFileSync(path.join(workspace, "src/comp.tsx"), "x");
    const tool = globTool(workspace);
    const r = await tool.do({ pattern: "**/*.{ts,tsx}" }, display, glove);
    expect(r.status).toBe("success");
    const lines = (r.data as string).split("\n");
    expect(lines).toContain("src/a/b/file.ts");
    expect(lines).toContain("src/comp.tsx");
  });

  test("[abc] works", async () => {
    fs.writeFileSync(path.join(workspace, "a.log"), "");
    fs.writeFileSync(path.join(workspace, "b.log"), "");
    fs.writeFileSync(path.join(workspace, "c.log"), "");
    fs.writeFileSync(path.join(workspace, "d.log"), "");
    const tool = globTool(workspace);
    const r = await tool.do({ pattern: "[ab].log" }, display, glove);
    expect(r.status).toBe("success");
    const lines = (r.data as string).split("\n");
    expect(lines).toContain("a.log");
    expect(lines).toContain("b.log");
    expect(lines).not.toContain("c.log");
    expect(lines).not.toContain("d.log");
  });

  test("no matches returns '(no matches)'", async () => {
    const tool = globTool(workspace);
    const r = await tool.do({ pattern: "**/*.never-exists-xyz" }, display, glove);
    expect(r.status).toBe("success");
    expect(r.data as string).toBe("(no matches)");
  });

  test("limit caps output", async () => {
    for (let i = 0; i < 20; i++) {
      fs.writeFileSync(path.join(workspace, `lim_${i}.log`), "x");
    }
    const tool = globTool(workspace);
    const r = await tool.do({ pattern: "*.log", limit: 5 }, display, glove);
    expect(r.status).toBe("success");
    const lines = (r.data as string).split("\n").filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(5);
  });

  test("sort by recency (mtime desc)", async () => {
    const old = path.join(workspace, "old.tx");
    const recent = path.join(workspace, "new.tx");
    fs.writeFileSync(old, "");
    fs.writeFileSync(recent, "");
    const past = new Date(Date.now() - 3600_000);
    fs.utimesSync(old, past, past);
    const tool = globTool(workspace);
    const r = await tool.do({ pattern: "*.tx" }, display, glove);
    expect(r.status).toBe("success");
    const lines = (r.data as string).split("\n").filter(Boolean);
    expect(lines[0]).toBe("new.tx");
    expect(lines[1]).toBe("old.tx");
  });

  test("ignored dirs (node_modules) are skipped", async () => {
    fs.mkdirSync(path.join(workspace, "node_modules/pkg"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "node_modules/pkg/index.ts"), "x");
    const tool = globTool(workspace);
    const r = await tool.do({ pattern: "**/*.ts" }, display, glove);
    expect(r.status).toBe("success");
    expect(r.data as string).not.toContain("node_modules");
  });

  test("hidden files: arbitrary hidden file is NOT surfaced", async () => {
    fs.writeFileSync(path.join(workspace, ".secret"), "x");
    const tool = globTool(workspace);
    const r = await tool.do({ pattern: "**/*" }, display, glove);
    expect(r.status).toBe("success");
    expect(r.data as string).not.toContain(".secret");
  });

  test("hidden files: .gitignore IS surfaced (allowlist)", async () => {
    fs.writeFileSync(path.join(workspace, ".gitignore"), "x");
    const tool = globTool(workspace);
    const r = await tool.do({ pattern: ".gitignore" }, display, glove);
    expect(r.status).toBe("success");
    expect(r.data as string).toContain(".gitignore");
  });

  test("provides a compact summary for older glob results", async () => {
    const tool = globTool(workspace);
    const r = await tool.do({ pattern: "**/*.ts" }, display, glove);
    const summary = await tool.generateToolSummary?.(r.generateSummaryArgs);
    expect(summary).toContain("glob **/*.ts");
    expect(summary).toContain("path");
    expect(summary).toContain("Full prior path list omitted");
  });
});

// =====================================================================
// grep.ts
// =====================================================================
describe("grepTool", () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "src/one.ts"), "hello world\nfoo bar\n");
    fs.writeFileSync(path.join(workspace, "src/two.ts"), "another line\nworld here\n");
    fs.writeFileSync(path.join(workspace, "src/three.txt"), "world\n");
  });

  test("regex match across files", async () => {
    const tool = grepTool(workspace);
    const r = await tool.do({ pattern: "world" }, display, glove);
    expect(r.status).toBe("success");
    const out = r.data as string;
    expect(out).toContain("src/one.ts:1:hello world");
    expect(out).toContain("src/two.ts:2:world here");
    expect(out).toContain("src/three.txt:1:world");
  });

  test("glob filter restricts files", async () => {
    const tool = grepTool(workspace);
    const r = await tool.do({ pattern: "world", glob: "**/*.ts" }, display, glove);
    expect(r.status).toBe("success");
    const out = r.data as string;
    expect(out).toContain("src/one.ts");
    expect(out).toContain("src/two.ts");
    expect(out).not.toContain("three.txt");
  });

  test("context: 2 includes surrounding lines", async () => {
    fs.writeFileSync(path.join(workspace, "src/ctx.ts"), "l1\nl2\nMATCH\nl4\nl5\n");
    const tool = grepTool(workspace);
    const r = await tool.do({ pattern: "MATCH", context: 2 }, display, glove);
    expect(r.status).toBe("success");
    const out = r.data as string;
    expect(out).toContain("src/ctx.ts:1:l1");
    expect(out).toContain("src/ctx.ts:3:MATCH");
    expect(out).toContain("src/ctx.ts:5:l5");
  });

  test("invalid regex returns error", async () => {
    const tool = grepTool(workspace);
    const r = await tool.do({ pattern: "[unclosed" }, display, glove);
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/Invalid regex/);
  });

  test("case_insensitive works", async () => {
    fs.writeFileSync(path.join(workspace, "src/ci.ts"), "HELLO\nlowercase\n");
    const tool = grepTool(workspace);
    const r = await tool.do({ pattern: "hello", case_insensitive: true }, display, glove);
    expect(r.status).toBe("success");
    expect(r.data as string).toContain("src/ci.ts:1:HELLO");
  });

  test("max_results caps", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `MATCH ${i}`).join("\n");
    fs.writeFileSync(path.join(workspace, "src/many.ts"), lines);
    const tool = grepTool(workspace);
    const r = await tool.do({ pattern: "MATCH", max_results: 5 }, display, glove);
    expect(r.status).toBe("success");
    const out = (r.data as string).split("\n").filter((l) => l.includes("MATCH"));
    expect(out.length).toBeLessThanOrEqual(5);
  });

  test("provides a path-count summary for older grep results", async () => {
    const tool = grepTool(workspace);
    const r = await tool.do({ pattern: "world" }, display, glove);
    const summary = await tool.generateToolSummary?.(r.generateSummaryArgs);
    expect(summary).toContain("3 matches across 3 files");
    expect(summary).toContain("src/one.ts:1 (1 match)");
    expect(summary).toContain("Full prior match text omitted");
    expect(summary).not.toContain("hello world");
  });
});

// =====================================================================
// ls.ts
// =====================================================================
describe("lsTool", () => {
  test("lists directory contents (dirs first, sorted)", async () => {
    fs.writeFileSync(path.join(workspace, "z-file.txt"), "x");
    fs.mkdirSync(path.join(workspace, "adir"));
    fs.writeFileSync(path.join(workspace, "a-file.txt"), "x");
    const tool = lsTool(workspace);
    const r = await tool.do({}, display, glove);
    expect(r.status).toBe("success");
    const out = r.data as string;
    const adirIdx = out.indexOf("adir/");
    const aFileIdx = out.indexOf("a-file.txt");
    const zFileIdx = out.indexOf("z-file.txt");
    expect(adirIdx).toBeGreaterThan(-1);
    expect(aFileIdx).toBeGreaterThan(-1);
    expect(zFileIdx).toBeGreaterThan(-1);
    expect(adirIdx).toBeLessThan(aFileIdx);
    expect(aFileIdx).toBeLessThan(zFileIdx);
  });

  test("hidden files: default hides dot-files", async () => {
    fs.writeFileSync(path.join(workspace, ".hidden"), "x");
    fs.writeFileSync(path.join(workspace, "shown.txt"), "x");
    const tool = lsTool(workspace);
    const r = await tool.do({}, display, glove);
    expect(r.status).toBe("success");
    expect(r.data as string).not.toContain(".hidden");
    expect(r.data as string).toContain("shown.txt");
  });

  test("hidden files: show_hidden=true reveals them", async () => {
    fs.writeFileSync(path.join(workspace, ".hidden"), "x");
    const tool = lsTool(workspace);
    const r = await tool.do({ show_hidden: true }, display, glove);
    expect(r.status).toBe("success");
    expect(r.data as string).toContain(".hidden");
  });

  test("directory not found returns error", async () => {
    const tool = lsTool(workspace);
    const r = await tool.do({ path: "no-such-dir" }, display, glove);
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/Not a directory/);
  });

  test("empty directory says so", async () => {
    fs.mkdirSync(path.join(workspace, "empty"));
    const tool = lsTool(workspace);
    const r = await tool.do({ path: "empty" }, display, glove);
    expect(r.status).toBe("success");
    expect(r.data as string).toContain("(empty directory)");
  });

  test("refuses path outside workspace", async () => {
    const tool = lsTool(workspace);
    await expect(tool.do({ path: "/etc" }, display, glove)).rejects.toThrow(
      /outside the workspace/,
    );
  });

  test("caps very large directory listings", async () => {
    fs.mkdirSync(path.join(workspace, "many"));
    for (let i = 0; i < 520; i++) {
      fs.writeFileSync(path.join(workspace, "many", `f${String(i).padStart(3, "0")}.txt`), "x");
    }
    const tool = lsTool(workspace);
    const r = await tool.do({ path: "many" }, display, glove);
    expect(r.status).toBe("success");
    expect(r.data as string).toContain("entries omitted");
    const summary = await tool.generateToolSummary?.(r.generateSummaryArgs);
    expect(summary).toContain("ls many: 520 entries");
    expect(summary).toContain("Full prior directory listing omitted");
  });
});

// =====================================================================
// web_fetch.ts (using Bun.serve on a random port)
// =====================================================================
describe("webFetchTool", () => {
  let server: any;
  let baseUrl: string;

  beforeAll(async () => {
    const port = await getFreePort();
    server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch(req: Request) {
        const url = new URL(req.url);
        if (url.pathname === "/html") {
          return new Response(
            "<html><script>bad()</script><style>x{}</style><body>Hello <b>World</b>&amp;Friends</body></html>",
            { headers: { "content-type": "text/html" } },
          );
        }
        if (url.pathname === "/text") {
          return new Response("plain text payload", {
            headers: { "content-type": "text/plain" },
          });
        }
        if (url.pathname === "/404") {
          return new Response("nope", { status: 404, statusText: "Not Found" });
        }
        if (url.pathname === "/big") {
          return new Response("y".repeat(700_000));
        }
        if (url.pathname === "/slow") {
          return new Promise<Response>((resolve) => {
            setTimeout(() => resolve(new Response("late")), 3000);
          });
        }
        return new Response("ok");
      },
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    server?.stop(true);
  });

  test("text-mode strips HTML", async () => {
    const r = await webFetchTool.do({ url: `${baseUrl}/html` }, display, glove);
    expect(r.status).toBe("success");
    const out = r.data as string;
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<style");
    expect(out).not.toContain("<b>");
    expect(out).not.toContain("bad()");
    expect(out).toContain("Hello");
    expect(out).toContain("World");
    expect(out).toContain("&Friends");
  });

  test("raw mode preserves HTML", async () => {
    const r = await webFetchTool.do({ url: `${baseUrl}/html`, mode: "raw" }, display, glove);
    expect(r.status).toBe("success");
    expect(r.data as string).toContain("<script");
    expect(r.data as string).toContain("<style");
  });

  test("non-2xx returns error", async () => {
    const r = await webFetchTool.do({ url: `${baseUrl}/404` }, display, glove);
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/HTTP 404/);
  });

  test("very large response truncates at MAX_BYTES", async () => {
    const r = await webFetchTool.do({ url: `${baseUrl}/big`, mode: "raw" }, display, glove);
    expect(r.status).toBe("success");
    expect(r.data as string).toContain("truncated at");
    expect((r.data as string).length).toBeLessThan(525_000);
  });

  test("provides a compact summary for older fetch results", async () => {
    const r = await webFetchTool.do({ url: `${baseUrl}/text` }, display, glove);
    const summary = await webFetchTool.generateToolSummary?.(r.generateSummaryArgs);
    expect(summary).toContain(`Fetched ${baseUrl}/text`);
    expect(summary).toContain("Preview:");
    expect(summary).toContain("Full prior fetch body omitted");
  });

  test("fetch abort works", async () => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 200);
    const r = await webFetchTool.do(
      { url: `${baseUrl}/slow` },
      display,
      glove,
      ctrl.signal,
    );
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/fetch failed/);
  }, 5000);
});

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

// =====================================================================
// transmission.ts
// =====================================================================
describe("transmissionTool", () => {
  test("writes JSONL line and emits bridge event", async () => {
    const events: any[] = [];
    const unsub = getBridge().subscribe((e) => events.push(e));
    try {
      const tool = transmissionTool(dataDir);
      const r = await tool.do(
        { subject: "test event", body: "this is a test of the transmission" },
        display,
        glove,
      );
      expect(r.status).toBe("success");
      const file = path.join(dataDir, "transmissions.jsonl");
      expect(fs.existsSync(file)).toBe(true);
      const line = fs.readFileSync(file, "utf-8").trim();
      const parsed = JSON.parse(line);
      expect(parsed.subject).toBe("test event");
      expect(parsed.body).toBe("this is a test of the transmission");
      expect(parsed.severity).toBe("low");
      const t = events.find((e) => e.type === "transmission");
      expect(t).toBeDefined();
      expect(t.severity).toBe("low");
      expect(t.payload).toContain("[LOW]");
      expect(t.payload).toContain("test event");
    } finally {
      unsub();
    }
  });

  test("severity defaults to 'low'", async () => {
    const tool = transmissionTool(dataDir);
    const r = await tool.do(
      { subject: "no sev", body: "no severity given here" },
      display,
      glove,
    );
    expect((r.renderData as any).severity).toBe("low");
  });

  test("severity high emits high event", async () => {
    const events: any[] = [];
    const unsub = getBridge().subscribe((e) => events.push(e));
    try {
      const tool = transmissionTool(dataDir);
      await tool.do(
        { subject: "high event", body: "this is a big deal", severity: "high" },
        display,
        glove,
      );
      const t = events.find((e) => e.type === "transmission" && e.severity === "high");
      expect(t).toBeDefined();
      expect(t.payload).toContain("[HIGH]");
    } finally {
      unsub();
    }
  });

  test("validates min body length via Zod schema", () => {
    const tool = transmissionTool(dataDir);
    const result = tool.inputSchema!.safeParse({ subject: "ok subject", body: "short" });
    expect(result.success).toBe(false);
  });

  test("validates max body length via Zod schema", () => {
    const tool = transmissionTool(dataDir);
    const result = tool.inputSchema!.safeParse({
      subject: "ok subject",
      body: "x".repeat(601),
    });
    expect(result.success).toBe(false);
  });

  test("validates min subject length via Zod schema", () => {
    const tool = transmissionTool(dataDir);
    const result = tool.inputSchema!.safeParse({ subject: "ab", body: "ok body text" });
    expect(result.success).toBe(false);
  });

  test("validates max subject length via Zod schema", () => {
    const tool = transmissionTool(dataDir);
    const result = tool.inputSchema!.safeParse({
      subject: "x".repeat(121),
      body: "ok body text",
    });
    expect(result.success).toBe(false);
  });

  test("concurrent writes append cleanly (JSONL line integrity)", async () => {
    const tool = transmissionTool(dataDir);
    const N = 10;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        tool.do(
          { subject: `s ${i}`, body: `body number ${i} here` },
          display,
          glove,
        ),
      ),
    );
    const lines = fs
      .readFileSync(path.join(dataDir, "transmissions.jsonl"), "utf-8")
      .trim()
      .split("\n");
    expect(lines.length).toBe(N);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
