import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  MAX_TOOL_RESULT_CHARS,
  clampText,
  clampToolResultData,
  withResultClamp,
} from "../src/agent/tools/result-clamp.ts";
import { readTool } from "../src/agent/tools/read.ts";
import { grepTool } from "../src/agent/tools/grep.ts";
import { webFetchTool } from "../src/agent/tools/webfetch.ts";

const display: any = {};
const glove: any = {};

let workspace: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-clamp-"));
});

afterEach(() => {
  try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {}
});

// =====================================================================
// clampText / clampToolResultData
// =====================================================================
describe("clampText", () => {
  test("returns short text unchanged", () => {
    expect(clampText("hello")).toBe("hello");
  });

  test("keeps head and tail with an elision marker", () => {
    const text = "A".repeat(150_000) + "MIDDLE" + "Z".repeat(150_000);
    const clamped = clampText(text);
    expect(clamped.length).toBeLessThan(MAX_TOOL_RESULT_CHARS + 300);
    expect(clamped.startsWith("AAAA")).toBe(true);
    expect(clamped.endsWith("ZZZZ")).toBe(true);
    expect(clamped).toContain("tool result clamped");
    expect(clamped).not.toContain("MIDDLE");
  });
});

describe("clampToolResultData", () => {
  test("leaves small results untouched (same reference)", () => {
    const result = { status: "success" as const, data: "ok", renderData: { a: 1 } };
    expect(clampToolResultData(result)).toBe(result);
  });

  test("clamps oversized string data", () => {
    const result = { status: "success" as const, data: "x".repeat(MAX_TOOL_RESULT_CHARS * 2) };
    const out = clampToolResultData(result);
    expect((out.data as string).length).toBeLessThan(MAX_TOOL_RESULT_CHARS + 300);
    expect(out.data as string).toContain("tool result clamped");
  });

  test("serializes and clamps oversized structured data", () => {
    const result = {
      status: "success" as const,
      data: { rows: Array.from({ length: 5000 }, (_, i) => `row-${i}-${"y".repeat(40)}`) },
    };
    const out = clampToolResultData(result);
    expect(typeof out.data).toBe("string");
    expect(out.data as string).toContain("structured tool result too large");
  });

  test("keeps small structured data as-is", () => {
    const result = { status: "success" as const, data: { tasks: [{ id: 1 }] } };
    expect(clampToolResultData(result).data).toBe(result.data);
  });

  test("clamps oversized error messages but preserves renderData", () => {
    const renderData = { image: "payload" };
    const result = { status: "error" as const, data: null, message: "e".repeat(50_000), renderData };
    const out = clampToolResultData(result);
    expect((out.message as string).length).toBeLessThan(11_000);
    expect(out.renderData).toBe(renderData);
  });
});

describe("withResultClamp", () => {
  test("clamps whatever the wrapped tool returns", async () => {
    const tool = withResultClamp({
      name: "big",
      description: "returns too much",
      do: async () => ({ status: "success" as const, data: "z".repeat(500_000) }),
    });
    const out = await tool.do(undefined, display, glove);
    expect((out.data as string).length).toBeLessThan(MAX_TOOL_RESULT_CHARS + 300);
    expect(tool.name).toBe("big");
  });
});

// =====================================================================
// read: minified-file caps
// =====================================================================
describe("read output caps", () => {
  test("clamps a single minified line instead of returning it whole", async () => {
    fs.writeFileSync(path.join(workspace, "min.js"), "const x=1;".repeat(20_000)); // 200k chars, one line
    const result = await readTool(workspace).do({ path: "min.js" }, display, glove);
    expect(result.status).toBe("success");
    expect((result.data as string).length).toBeLessThan(3000);
    expect(result.data as string).toContain("[line truncated");
  });

  test("enforces a total char budget across many long lines with a resume offset", async () => {
    const line = "a".repeat(1500);
    fs.writeFileSync(path.join(workspace, "wide.txt"), Array(100).fill(line).join("\n"));
    const result = await readTool(workspace).do({ path: "wide.txt" }, display, glove);
    const data = result.data as string;
    expect(data.length).toBeLessThan(90_000);
    expect(data).toContain("output clamped");
    expect(data).toMatch(/call read again with offset=\d+/);
  });

  test("normal files are unaffected", async () => {
    fs.writeFileSync(path.join(workspace, "ok.txt"), "one\ntwo\nthree");
    const result = await readTool(workspace).do({ path: "ok.txt" }, display, glove);
    expect(result.data as string).toContain("1→one");
    expect(result.data as string).toContain("3→three");
    expect(result.data as string).not.toContain("clamped");
  });
});

// =====================================================================
// grep: long match lines
// =====================================================================
describe("grep line clipping", () => {
  test("clips very long matching lines", async () => {
    fs.writeFileSync(path.join(workspace, "min.js"), "needle" + "b".repeat(100_000));
    const result = await grepTool(workspace).do({ pattern: "needle" }, display, glove);
    const data = result.data as string;
    expect(data.length).toBeLessThan(1000);
    expect(data).toContain("[+");
    expect(data).toContain("min.js:1:needle");
  });
});

// =====================================================================
// web_fetch: output char cap
// =====================================================================
describe("web_fetch output cap", () => {
  test("clamps huge bodies well below the fetch byte cap", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("w".repeat(300_000), { headers: { "content-type": "text/plain" } }),
    });
    try {
      const result = await webFetchTool.do(
        { url: `http://localhost:${server.port}/big`, mode: "raw" },
        display,
        glove,
      );
      expect(result.status).toBe("success");
      expect((result.data as string).length).toBeLessThan(101_000);
      expect(result.data as string).toContain("output clamped at");
      expect((result.renderData as { truncated: boolean }).truncated).toBe(true);
    } finally {
      server.stop(true);
    }
  });
});
