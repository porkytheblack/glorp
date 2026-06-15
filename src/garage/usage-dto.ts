/** Wire-shape conversions for the token-usage surfaces (GET /usage, …). */

import type { ModelUsage, UsageTotals } from "../agent/usage.ts";
import type { ModelUsageDto, UsageTotalsDto } from "./types.ts";

/** Round currency to micro-dollars so the wire carries no float noise. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function totalsToDto(t: UsageTotals): UsageTotalsDto {
  return {
    tokens_in: t.tokensIn,
    tokens_out: t.tokensOut,
    cost_usd: round6(t.costUsd),
    cost_known: t.costKnown,
  };
}

export function modelUsageToDto(u: ModelUsage): ModelUsageDto {
  return {
    provider_id: u.providerId,
    model: u.model,
    label: u.label ?? null,
    tokens_in: u.tokensIn,
    tokens_out: u.tokensOut,
    requests: u.requests,
    cost_usd: round6(u.costUsd),
    cost_known: u.costKnown,
  };
}

/** Sort heaviest-spend first so the most material models lead any list. */
export function byCostDesc(a: ModelUsageDto, b: ModelUsageDto): number {
  return b.cost_usd - a.cost_usd || b.tokens_out - a.tokens_out;
}
