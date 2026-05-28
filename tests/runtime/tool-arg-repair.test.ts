import { describe, test, expect } from "bun:test";
import { repairJsonArgs } from "../../src/agent/runtime/tool-arg-repair.ts";

describe("repairJsonArgs — pass-through", () => {
  test("non-string values are returned as-is", () => {
    expect(repairJsonArgs({ a: 1 })).toEqual({ a: 1 });
    expect(repairJsonArgs(null)).toBeNull();
    expect(repairJsonArgs(42)).toBe(42);
  });

  test("parses valid JSON string", () => {
    const obj = { path: "/tmp/test.js", content: "hello" };
    expect(repairJsonArgs(JSON.stringify(obj))).toEqual(obj);
  });

  test("non-JSON strings returned as-is", () => {
    expect(repairJsonArgs("just text")).toBe("just text");
    expect(repairJsonArgs("")).toBe("");
  });
});

describe("repairJsonArgs — truncation", () => {
  test("closes truncated string value", () => {
    // Model ran out of tokens mid-content
    const broken = '{"path":"a.js","content":"const x = 1;\\nconst';
    const result = repairJsonArgs(broken) as Record<string, string>;
    expect(result).toBeObject();
    expect(result.path).toBe("a.js");
    expect(result.content).toBe("const x = 1;\nconst");
  });

  test("closes truncated with trailing backslash", () => {
    const broken = '{"path":"a.js","content":"hello\\';
    const result = repairJsonArgs(broken) as Record<string, string>;
    expect(result).toBeObject();
    expect(result.path).toBe("a.js");
    expect(result.content).toBe("hello");
  });

  test("closes nested objects", () => {
    const broken = '{"config":{"nested":{"deep":"val';
    const result = repairJsonArgs(broken) as Record<string, unknown>;
    expect(result).toBeObject();
    const config = result.config as Record<string, unknown>;
    const nested = config.nested as Record<string, string>;
    expect(nested.deep).toBe("val");
  });

  test("closes truncated arrays", () => {
    const broken = '{"items":["a","b","trunc';
    const result = repairJsonArgs(broken) as Record<string, unknown>;
    expect(result).toBeObject();
    expect(Array.isArray(result.items)).toBe(true);
  });

  test("handles large truncated content (real-world pattern)", () => {
    // Simulate a write tool call truncated at ~500 chars
    const jsCode = 'const pptxgen = require(\\"pptxgenjs\\");\\n' +
      'const pres = new pptxgen();\\n' +
      'const COLORS = { bg: \\"0D1117\\", text: \\"F0F6FC\\" };\\n' +
      'function createSlide() {\\n' +
      '  const s = pres.addSlide();\\n' +
      '  s.addShape(p';  // truncated here
    const broken = `{"path":"/tmp/deck.js","content":"${jsCode}`;
    const result = repairJsonArgs(broken) as Record<string, string>;
    expect(result).toBeObject();
    expect(result.path).toBe("/tmp/deck.js");
    expect(result.content).toContain("pptxgenjs");
    expect(result.content).toContain("s.addShape(p");
  });

  test("already-complete JSON is unchanged", () => {
    const valid = '{"a":"b","c":"d"}';
    expect(repairJsonArgs(valid)).toEqual({ a: "b", c: "d" });
  });
});

describe("repairJsonArgs — bad escaping", () => {
  test("repairs unescaped quotes inside string values", () => {
    const broken = '{"path":"a.js","content":"require("pptxgenjs");"}';
    const result = repairJsonArgs(broken) as Record<string, string>;
    expect(result).toBeObject();
    expect(result.path).toBe("a.js");
    expect(result.content).toBe('require("pptxgenjs");');
  });

  test("repairs multiple unescaped quotes", () => {
    const broken = '{"code":"let x = \"hello\" + \"world\";","file":"t.js"}';
    const result = repairJsonArgs(broken) as Record<string, string>;
    expect(result).toBeObject();
    expect(result.code).toBe('let x = "hello" + "world";');
  });

  test("handles unescaped newlines in strings", () => {
    const broken = '{"content":"line1\nline2"}';
    const result = repairJsonArgs(broken) as Record<string, string>;
    expect(result).toBeObject();
    expect(result.content).toBe("line1\nline2");
  });

  test("preserves already-escaped quotes", () => {
    const valid = '{"content":"require(\\"x\\")"}';
    const result = repairJsonArgs(valid) as Record<string, string>;
    expect(result).toBeObject();
    expect(result.content).toBe('require("x")');
  });
});

describe("repairJsonArgs — edge cases", () => {
  test("handles nested objects", () => {
    const valid = '{"name":"test","config":{"key":"val"}}';
    expect(repairJsonArgs(valid)).toEqual({ name: "test", config: { key: "val" } });
  });

  test("handles arrays", () => {
    const valid = '{"items":["a","b"],"count":2}';
    const result = repairJsonArgs(valid) as Record<string, unknown>;
    expect(result.items).toEqual(["a", "b"]);
  });

  test("gives up on hopeless input", () => {
    expect(repairJsonArgs("{{{bad")).toBe("{{{bad");
  });
});
