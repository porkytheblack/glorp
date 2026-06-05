import { describe, test, expect } from "bun:test";
import { inputInterface, tsType } from "../src/mcpgen/schema-ts.ts";

describe("tsType", () => {
  test("primitives", () => {
    expect(tsType({ type: "string" })).toBe("string");
    expect(tsType({ type: "integer" })).toBe("number");
    expect(tsType({ type: "number" })).toBe("number");
    expect(tsType({ type: "boolean" })).toBe("boolean");
  });

  test("enum renders a literal union", () => {
    expect(tsType({ type: "string", enum: ["a", "b"] })).toBe('"a" | "b"');
  });

  test("array of strings", () => {
    expect(tsType({ type: "array", items: { type: "string" } })).toBe("Array<string>");
  });

  test("anyOf renders a union", () => {
    expect(tsType({ anyOf: [{ type: "string" }, { type: "number" }] })).toBe("string | number");
  });

  test("missing / empty schema falls back to unknown", () => {
    expect(tsType(undefined)).toBe("unknown");
    expect(tsType({})).toBe("unknown");
  });
});

describe("inputInterface", () => {
  test("required vs optional fields", () => {
    const out = inputInterface("Foo", {
      type: "object",
      properties: { title: { type: "string" }, count: { type: "number" } },
      required: ["title"],
    });
    expect(out).toContain("export interface Foo {");
    expect(out).toContain("title: string;");
    expect(out).toContain("count?: number;");
  });

  test("no properties → index signature", () => {
    expect(inputInterface("Empty", { type: "object" })).toContain("[key: string]: unknown;");
  });

  test("quotes identifiers that are not valid keys", () => {
    const out = inputInterface("Weird", { type: "object", properties: { "a-b": { type: "string" } }, required: ["a-b"] });
    expect(out).toContain('"a-b": string;');
  });
});
