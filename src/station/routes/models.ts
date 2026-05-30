/**
 * Centralized model management: list configured providers and profiles, and
 * set the Station-wide default profile. API keys are never returned — only
 * whether a provider has one configured.
 */

import type { CredentialsStore } from "../../agent/credentials.ts";
import { json, errorJson } from "../respond.ts";

export interface ModelRoutes {
  providers(): Response;
  profiles(): Response;
  activate(id: string): Response;
}

export function modelRoutes(credentials: CredentialsStore): ModelRoutes {
  return {
    providers(): Response {
      const providers = credentials.listProviders().map((p) => ({
        id: p.id,
        type: p.type,
        based_on: p.basedOn ?? null,
        adapter: p.adapter ?? null,
        base_url: p.baseURL ?? null,
        context_limit: p.contextLimit ?? null,
        has_api_key: Boolean(p.apiKey),
      }));
      return json({ providers });
    },

    profiles(): Response {
      const active = credentials.getActiveProfile();
      const profiles = credentials.listProfiles().map((p) => ({
        id: p.id,
        label: p.label,
        provider_id: p.providerId,
        model: p.model,
        last_used_at: p.lastUsedAt ?? null,
      }));
      return json({ profiles, active_profile_id: active?.id ?? null });
    },

    activate(id): Response {
      if (!credentials.getProfile(id)) {
        return errorJson("not_found", `Profile ${id} not found`, 404);
      }
      credentials.setActive(id);
      return json({ active_profile_id: id });
    },
  };
}
