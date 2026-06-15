/**
 * Token-usage accounting with per-model attribution and catalog-based cost.
 *
 * glove-core hands the store only `{ tokens_in, tokens_out }` per model turn —
 * no model id, no provider-reported price. So we attribute each delta to the
 * model that is *active* on the store at the time (see `GlorpStore.setActiveModel`)
 * and price it from the models.dev catalog list rates already cached locally.
 * `costKnown` is false whenever a contributing model had no catalog price
 * (custom/local endpoints), so UIs can render the figure as a floor, not truth.
 */

import type { ModelCost } from "./model-catalog.ts";

/** A persisted per-(provider, model) usage bucket on one session's store. */
export interface ModelUsage {
  providerId: string;
  model: string;
  /** Human label captured at first attribution, e.g. "anthropic · opus". */
  label?: string;
  tokensIn: number;
  tokensOut: number;
  /** Model turns attributed here (one per `addTokens` call). */
  requests: number;
  /** Estimated USD from catalog list pricing; 0 when no price was available. */
  costUsd: number;
  /** False once any attributed turn lacked a catalog price. */
  costKnown: boolean;
}

/** A rolled-up total across many models/sessions. */
export interface UsageTotals {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** True only when every contributing usage had a known price. */
  costKnown: boolean;
}

/** Stable map key for a (provider, model) pair. */
export function modelKey(providerId: string, model: string): string {
  return `${providerId}/${model}`;
}

/**
 * Catalog list-price cost (USD) for a token delta. models.dev rates are
 * per-million tokens. `known` is false unless BOTH the input and output rates
 * exist — a one-sided rate would bill the missing side at $0 and present an
 * undercount as authoritative, so we return the partial cost as a *floor* and
 * flag it unknown.
 */
export function tokenCostUsd(
  tokensIn: number,
  tokensOut: number,
  cost?: ModelCost,
): { usd: number; known: boolean } {
  const inRate = cost?.input;
  const outRate = cost?.output;
  const usd = (tokensIn / 1e6) * (inRate ?? 0) + (tokensOut / 1e6) * (outRate ?? 0);
  return { usd, known: inRate != null && outRate != null };
}

export function emptyTotals(): UsageTotals {
  return { tokensIn: 0, tokensOut: 0, costUsd: 0, costKnown: true };
}

/** Fold one usage record into a running total (mutates `t`). */
export function addToTotals(
  t: UsageTotals,
  u: { tokensIn: number; tokensOut: number; costUsd: number; costKnown: boolean },
): void {
  t.tokensIn += u.tokensIn;
  t.tokensOut += u.tokensOut;
  t.costUsd += u.costUsd;
  // Only unknown pricing on a non-empty bucket taints the total.
  if (!u.costKnown && (u.tokensIn > 0 || u.tokensOut > 0)) t.costKnown = false;
}

/** Sum a list of per-model buckets into a single total. */
export function totalsOf(usage: ModelUsage[]): UsageTotals {
  const t = emptyTotals();
  for (const u of usage) addToTotals(t, u);
  return t;
}

/**
 * Token + cost totals for a store, reconciling the per-model ledger against the
 * flat counters. The counters are authoritative for tokens; when they exceed the
 * ledger (a session that accrued tokens before usage tracking existed, or
 * untracked sub-store spend) the surplus is unpriced, so the cost is a floor and
 * `costKnown` is false.
 */
export function storeTotals(tokensIn: number, tokensOut: number, usage: ModelUsage[]): UsageTotals {
  const ledger = totalsOf(usage);
  const untracked = tokensIn + tokensOut > ledger.tokensIn + ledger.tokensOut;
  return { tokensIn, tokensOut, costUsd: ledger.costUsd, costKnown: ledger.costKnown && !untracked };
}

/** Merge per-model buckets keyed by provider/model into `into` (mutates it). */
export function mergeModelUsage(into: Map<string, ModelUsage>, list: ModelUsage[]): void {
  for (const m of list) {
    const k = modelKey(m.providerId, m.model);
    const cur = into.get(k);
    if (!cur) {
      into.set(k, { ...m });
      continue;
    }
    cur.tokensIn += m.tokensIn;
    cur.tokensOut += m.tokensOut;
    cur.requests += m.requests;
    cur.costUsd += m.costUsd;
    cur.costKnown = cur.costKnown && m.costKnown;
    if (!cur.label && m.label) cur.label = m.label;
  }
}

/** Normalize an unknown persisted value into a clean ModelUsage record. */
export function coerceModelUsage(raw: unknown): ModelUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.providerId !== "string" || typeof r.model !== "string") return null;
  return {
    providerId: r.providerId,
    model: r.model,
    label: typeof r.label === "string" ? r.label : undefined,
    tokensIn: num(r.tokensIn),
    tokensOut: num(r.tokensOut),
    requests: num(r.requests),
    costUsd: num(r.costUsd),
    costKnown: r.costKnown !== false,
  };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
