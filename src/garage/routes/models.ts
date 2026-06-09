/**
 * Model management: list/activate the Garage's configured providers + profiles,
 * browse the known-provider catalog, and ADD/REMOVE providers and profiles.
 * API keys are accepted on write but never returned — reads expose only
 * `has_api_key`.
 */

import {
  CredentialsStore,
  KNOWN_PROVIDERS,
  CUSTOM_PROVIDER_ADAPTERS,
  findKnownProvider,
  effectiveProviderId,
  reasoningOptionsFor,
} from "../../agent/credentials.ts";
import type {
  ProviderConfig,
  ModelProfile,
  KnownProvider,
  CustomProviderAdapter,
  ReasoningConfig,
} from "../../agent/credentials.ts";
import { json, errorJson, noContent, readJson } from "../respond.ts";

export interface ModelRoutes {
  providers(): Response;
  profiles(): Response;
  activate(id: string): Response;
  catalog(): Response;
  reasoningOptions(req: Request): Response;
  addProvider(req: Request): Promise<Response>;
  deleteProvider(id: string): Response;
  addProfile(req: Request): Promise<Response>;
  deleteProfile(id: string): Response;
}

function providerDto(p: ProviderConfig) {
  return {
    id: p.id,
    type: p.type,
    based_on: p.basedOn ?? null,
    adapter: p.adapter ?? null,
    base_url: p.baseURL ?? null,
    context_limit: p.contextLimit ?? null,
    has_api_key: Boolean(p.apiKey),
  };
}

function profileDto(p: ModelProfile) {
  return { id: p.id, label: p.label, provider_id: p.providerId, model: p.model, last_used_at: p.lastUsedAt ?? null };
}

export function modelRoutes(credentials: CredentialsStore): ModelRoutes {
  return {
    providers(): Response {
      return json({ providers: credentials.listProviders().map(providerDto) });
    },

    profiles(): Response {
      const active = credentials.getActiveProfile();
      return json({ profiles: credentials.listProfiles().map(profileDto), active_profile_id: active?.id ?? null });
    },

    activate(id): Response {
      if (!credentials.getProfile(id)) return errorJson("not_found", `Profile ${id} not found`, 404);
      credentials.setActive(id);
      return json({ active_profile_id: id });
    },

    /** The known providers + their selectable models, plus the custom-endpoint
     * adapters — everything an "add provider / add model" UI needs to offer
     * guided choices instead of free-text. */
    catalog(): Response {
      const providers = KNOWN_PROVIDERS.map((p) => ({
        id: p.id,
        label: p.label,
        description: p.description,
        env_var: p.envVar || null,
        default_models: p.defaultModels,
        needs_api_key: p.needsApiKey,
        reasoning_capable: p.reasoningCapableModelMatchers.length > 0,
      }));
      const adapters = CUSTOM_PROVIDER_ADAPTERS.map((a) => ({
        id: a.id,
        label: a.label,
        description: a.description,
      }));
      return json({ providers, adapters });
    },

    /** The reasoning/thinking options valid for a (provider, model) pair, so the
     * UI can offer the same picker the CLI does. Resolves custom providers
     * through their effective known provider (e.g. basedOn) before matching. */
    reasoningOptions(req): Response {
      const url = new URL(req.url);
      const providerId = url.searchParams.get("provider") ?? "";
      const model = url.searchParams.get("model") ?? "";
      if (!providerId || !model) {
        return errorJson("bad_request", "'provider' and 'model' query params are required", 400);
      }
      const effective = effectiveProviderId(providerId, credentials.getProvider(providerId), model);
      return json({ options: reasoningOptionsFor(effective, model) });
    },

    async addProvider(req): Promise<Response> {
      let body: {
        id?: string;
        type?: "known" | "custom";
        baseURL?: string;
        apiKey?: string;
        basedOn?: string;
        adapter?: string;
        contextLimit?: number;
      };
      try {
        body = await readJson(req);
      } catch {
        return errorJson("bad_request", "Invalid JSON body", 400);
      }
      if (!body.id) return errorJson("bad_request", "provider 'id' is required", 400);
      const type = body.type ?? (findKnownProvider(body.id) ? "known" : "custom");
      const provider: ProviderConfig = {
        type,
        id: body.id,
        ...(body.basedOn ? { basedOn: body.basedOn as KnownProvider } : {}),
        ...(body.adapter ? { adapter: body.adapter as CustomProviderAdapter } : {}),
        ...(body.baseURL ? { baseURL: body.baseURL } : {}),
        ...(body.apiKey ? { apiKey: body.apiKey } : {}),
        ...(body.contextLimit ? { contextLimit: body.contextLimit } : {}),
      };
      credentials.upsertProvider(provider);
      return json(providerDto(provider), 201);
    },

    deleteProvider(id): Response {
      if (!credentials.getProvider(id)) return errorJson("not_found", `Provider ${id} not found`, 404);
      credentials.removeProvider(id);
      return noContent();
    },

    async addProfile(req): Promise<Response> {
      let body: {
        providerId?: string;
        model?: string;
        label?: string;
        reasoning?: ReasoningConfig;
        contextLimit?: number;
        activate?: boolean;
      };
      try {
        body = await readJson(req);
      } catch {
        return errorJson("bad_request", "Invalid JSON body", 400);
      }
      if (!body.providerId || !body.model) {
        return errorJson("bad_request", "'providerId' and 'model' are required", 400);
      }
      const id = CredentialsStore.makeProfileId(body.providerId, body.model, body.reasoning);
      const profile: ModelProfile = {
        id,
        label: body.label?.trim() || `${body.providerId} · ${body.model}`,
        providerId: body.providerId,
        model: body.model,
        ...(body.reasoning ? { reasoning: body.reasoning } : {}),
        ...(body.contextLimit ? { contextLimit: body.contextLimit } : {}),
      };
      credentials.upsertProfile(profile);
      if (body.activate) credentials.setActive(id);
      return json(profileDto(profile), 201);
    },

    deleteProfile(id): Response {
      if (!credentials.getProfile(id)) return errorJson("not_found", `Profile ${id} not found`, 404);
      credentials.removeProfile(id);
      return noContent();
    },
  };
}
