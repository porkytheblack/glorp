/** Generic migration engine: ordering, no-op, future-version, edge cases. */

import { describe, test, expect } from "bun:test";
import { Migrator, type Migration } from "../../src/agent/migrations/engine.ts";

const chain: Migration[] = [
  { to: 1, description: "init a", up: (d) => ({ ...d, a: 1 }) },
  { to: 2, description: "derive b from a", up: (d) => ({ ...d, b: (d.a ?? 0) + 10 }) },
];

describe("Migrator", () => {
  test("rejects a non-contiguous chain", () => {
    expect(() => new Migrator("x", [
      { to: 1, description: "", up: (d) => d },
      { to: 3, description: "", up: (d) => d },
    ])).toThrow(/contiguous/);
  });

  test("currentVersion equals the chain length", () => {
    expect(new Migrator("x", chain).currentVersion).toBe(2);
    expect(new Migrator("empty", []).currentVersion).toBe(0);
  });

  test("migrates an unversioned doc through every step, in order", () => {
    const out = new Migrator<any>("x", chain).migrate({ name: "z" });
    expect(out.fromVersion).toBe(0);
    expect(out.toVersion).toBe(2);
    expect(out.applied.map((m) => m.to)).toEqual([1, 2]);
    expect(out.fromFuture).toBe(false);
    expect(out.data).toMatchObject({ name: "z", a: 1, b: 11, version: 2 });
  });

  test("applies only newer migrations for a partial version", () => {
    const out = new Migrator<any>("x", chain).migrate({ a: 5, version: 1 });
    expect(out.applied.map((m) => m.to)).toEqual([2]);
    expect(out.data).toMatchObject({ a: 5, b: 15, version: 2 });
  });

  test("is a no-op at the current version", () => {
    const out = new Migrator<any>("x", chain).migrate({ a: 99, b: 99, version: 2 });
    expect(out.applied).toHaveLength(0);
    expect(out.data).toMatchObject({ a: 99, b: 99, version: 2 });
  });

  test("leaves future-version docs untouched and flags them", () => {
    const out = new Migrator<any>("x", chain).migrate({ secret: "keep", version: 7 });
    expect(out.fromFuture).toBe(true);
    expect(out.applied).toHaveLength(0);
    expect(out.data).toMatchObject({ secret: "keep", version: 7 });
  });

  test("handles non-object input safely", () => {
    const m = new Migrator<any>("x", chain);
    expect(m.migrate(null).data).toMatchObject({ a: 1, b: 11, version: 2 });
    expect(m.migrate("nonsense").data).toMatchObject({ version: 2 });
  });

  test("needsMigration reflects the stored version", () => {
    const m = new Migrator<any>("x", chain);
    expect(m.needsMigration({ version: 0 })).toBe(true);
    expect(m.needsMigration({ version: 2 })).toBe(false);
    expect(m.needsMigration({ version: 9 })).toBe(false);
  });
});
