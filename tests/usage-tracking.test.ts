/**
 * Per-model token usage + catalog-priced cost: the store attributes each token
 * delta to its active model and values it from the catalog; the aggregation
 * helpers roll those buckets up; SessionStats folds cost off the wire events.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { GlorpStore } from "../src/agent/store.ts";
import { tokenCostUsd, totalsOf, storeTotals, mergeModelUsage, type ModelUsage } from "../src/agent/usage.ts";
import { SessionStats } from "../src/garage/session-stats.ts";

let dataDir: string;
beforeEach(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-usage-")); });
afterEach(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} });

describe("tokenCostUsd", () => {
  test("prices per-million input/output rates", () => {
    // $3/M in, $15/M out → 1M in + 0.5M out = 3 + 7.5 = 10.5
    const c = tokenCostUsd(1_000_000, 500_000, { input: 3, output: 15 });
    expect(c.known).toBe(true);
    expect(c.usd).toBeCloseTo(10.5, 6);
  });

  test("reports unknown when no rates exist", () => {
    const c = tokenCostUsd(1000, 1000, undefined);
    expect(c.known).toBe(false);
    expect(c.usd).toBe(0);
  });

  test("a one-sided rate is a floor, not authoritative", () => {
    // input priced, output missing → bill output at $0 but flag the figure unknown.
    const c = tokenCostUsd(1_000_000, 1_000_000, { input: 3 });
    expect(c.known).toBe(false);
    expect(c.usd).toBeCloseTo(3, 6);
  });
});

describe("storeTotals reconciliation", () => {
  test("counters beyond the priced ledger flag cost as a floor (legacy / untracked)", () => {
    // A pre-tracking session: real tokens on the counters, empty ledger.
    const t = storeTotals(5000, 2000, []);
    expect(t.tokensIn).toBe(5000);
    expect(t.tokensOut).toBe(2000);
    expect(t.costUsd).toBe(0);
    expect(t.costKnown).toBe(false);
  });

  test("counters matching the ledger stay authoritative", () => {
    const usage: ModelUsage[] = [
      { providerId: "anthropic", model: "opus", tokensIn: 5000, tokensOut: 2000, requests: 1, costUsd: 0.05, costKnown: true },
    ];
    const t = storeTotals(5000, 2000, usage);
    expect(t.costKnown).toBe(true);
    expect(t.costUsd).toBeCloseTo(0.05, 6);
  });
});

describe("GlorpStore usage ledger", () => {
  test("attributes deltas to the active model and prices them", async () => {
    const store = new GlorpStore("s1", dataDir);
    store.setActiveModel({ providerId: "anthropic", model: "opus", label: "anthropic · opus", cost: { input: 3, output: 15 } });
    await store.addTokens({ tokens_in: 1_000_000, tokens_out: 1_000_000 });
    await store.flush();

    const usage = store.getUsage();
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ providerId: "anthropic", model: "opus", tokensIn: 1_000_000, tokensOut: 1_000_000, requests: 1, costKnown: true });
    expect(usage[0]!.costUsd).toBeCloseTo(18, 6);
  });

  test("a mid-session model swap opens a second bucket (the chain)", async () => {
    const store = new GlorpStore("s2", dataDir);
    store.setActiveModel({ providerId: "anthropic", model: "sonnet", cost: { input: 3, output: 15 } });
    await store.addTokens({ tokens_in: 1000, tokens_out: 1000 });
    store.setActiveModel({ providerId: "openrouter", model: "z-ai/glm", cost: { input: 0.5, output: 2 } });
    await store.addTokens({ tokens_in: 2000, tokens_out: 2000 });
    await store.flush();

    const usage = store.getUsage();
    expect(usage).toHaveLength(2);
    const totals = totalsOf(usage);
    expect(totals.tokensIn).toBe(3000);
    expect(totals.tokensOut).toBe(3000);
    expect(totals.costKnown).toBe(true);
  });

  test("unknown pricing taints costKnown but still counts tokens", async () => {
    const store = new GlorpStore("s3", dataDir);
    store.setActiveModel({ providerId: "custom", model: "local-llama" }); // no cost
    await store.addTokens({ tokens_in: 5000, tokens_out: 1000 });
    await store.flush();
    const totals = totalsOf(store.getUsage());
    expect(totals.tokensIn).toBe(5000);
    expect(totals.costUsd).toBe(0);
    expect(totals.costKnown).toBe(false);
  });

  test("the ledger survives a reload from disk", async () => {
    const store = new GlorpStore("s4", dataDir);
    store.setActiveModel({ providerId: "anthropic", model: "opus", cost: { input: 3, output: 15 } });
    await store.addTokens({ tokens_in: 1_000_000, tokens_out: 0 });
    await store.flush();

    const reopened = new GlorpStore("s4", dataDir);
    const usage = reopened.getUsage();
    expect(usage).toHaveLength(1);
    expect(usage[0]!.costUsd).toBeCloseTo(3, 6);
  });

  test("resetCounters clears the ledger", async () => {
    const store = new GlorpStore("s5", dataDir);
    store.setActiveModel({ providerId: "anthropic", model: "opus", cost: { input: 3, output: 15 } });
    await store.addTokens({ tokens_in: 1000, tokens_out: 1000 });
    await store.resetCounters();
    await store.flush();
    expect(store.getUsage()).toHaveLength(0);
  });
});

describe("mergeModelUsage", () => {
  test("folds same-model buckets and keeps distinct ones", () => {
    const into = new Map<string, ModelUsage>();
    mergeModelUsage(into, [
      { providerId: "anthropic", model: "opus", tokensIn: 10, tokensOut: 5, requests: 1, costUsd: 1, costKnown: true },
    ]);
    mergeModelUsage(into, [
      { providerId: "anthropic", model: "opus", tokensIn: 20, tokensOut: 5, requests: 1, costUsd: 2, costKnown: true },
      { providerId: "openai", model: "gpt", tokensIn: 1, tokensOut: 1, requests: 1, costUsd: 0, costKnown: false },
    ]);
    const opus = into.get("anthropic/opus")!;
    expect(opus.tokensIn).toBe(30);
    expect(opus.requests).toBe(2);
    expect(opus.costUsd).toBeCloseTo(3, 6);
    expect(into.get("openai/gpt")!.costKnown).toBe(false);
  });
});

describe("SessionStats cost folding", () => {
  test("reads cost off stats + hydrate events, defaulting when absent", () => {
    const stats = new SessionStats();
    expect(stats.costUsd).toBe(0);
    expect(stats.costKnown).toBe(true);

    stats.apply({ type: "stats", stats: { turns: 1, tokens_in: 10, tokens_out: 5, contextPct: 1, cost_usd: 0.42, cost_known: false } });
    expect(stats.costUsd).toBeCloseTo(0.42, 6);
    expect(stats.costKnown).toBe(false);

    // A legacy producer that omits cost fields resets to the safe defaults.
    stats.apply({ type: "stats", stats: { turns: 2, tokens_in: 20, tokens_out: 10, contextPct: 2 } });
    expect(stats.costUsd).toBe(0);
    expect(stats.costKnown).toBe(true);
  });
});
