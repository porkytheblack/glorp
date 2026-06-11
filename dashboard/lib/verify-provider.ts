"use client";

/**
 * Verify a saved provider by asking the Garage to list its models live
 * (GET /models/providers/:id/models — the key never reaches the browser).
 * A model list means the key + base URL actually work; failures map to a
 * human verdict the UI can act on. Shared by first-run onboarding and the
 * add-provider flow.
 */

import { api, ApiError } from "./api";

export type VerifyOutcome =
  | { ok: true; models: string[] }
  | { ok: false; reason: "auth" | "network" | "upstream"; message: string };

export async function verifyProvider(providerId: string): Promise<VerifyOutcome> {
  try {
    const res = await api<{ models: string[] }>(`/models/providers/${providerId}/models`);
    return { ok: true, models: res.models ?? [] };
  } catch (e) {
    const raw = e instanceof ApiError ? e.message : String(e);
    if (/401|403|unauthorized|invalid api key|invalid authentication/i.test(raw)) {
      return { ok: false, reason: "auth", message: "The provider rejected the API key. Check the key and try again." };
    }
    if (/unreachable|timed? ?out|econnrefused|enotfound|fetch failed/i.test(raw)) {
      return { ok: false, reason: "network", message: "Could not reach the endpoint. Check the base URL." };
    }
    return { ok: false, reason: "upstream", message: raw };
  }
}
