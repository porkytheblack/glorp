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
  normaliseReasoning,
  reasoningLabel,
} from "../../agent/credentials.ts";
import { defaultBaseURLFor } from "../../agent/model-picker.ts";
import type { ModelCatalog } from "../../agent/model-catalog.ts";
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
  setReasoning(id: string, req: Request): Promise<Response>;
  deleteProfile(id: string): Response;
  listProviderModels(id: string): Promise<Response>;
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
  const reasoning = normaliseReasoning(p.reasoning);
  return {
    id: p.id,
    label: p.label,
    provider_id: p.providerId,
    model: p.model,
    reasoning,
    reasoning_label: reasoningLabel(reasoning),
    context_limit: p.contextLimit ?? null,
    last_used_at: p.lastUsedAt ?? null,
  };
}

export function modelRoutes(credentials: CredentialsStore, catalog?: ModelCatalog): ModelRoutes {
  /** Effective context window: explicit profile/provider override, else the
   * models.dev catalog (which resolves custom-provider models by name) — so
   * nobody has to hand-type context numbers. */
  const resolveContext = (p: ModelProfile): number | null => {
    if (p.contextLimit) return p.contextLimit;
    const provider = credentials.getProvider(p.providerId);
    if (provider?.contextLimit) return provider.contextLimit;
    const effective = effectiveProviderId(p.providerId, provider, p.model);
    return catalog?.getContextLimit(effective, p.model) ?? null;
  };
  /** Input modalities from the catalog (resolves custom providers by model
   * name) — lets UIs know up front whether a model can see images instead of
   * discovering it when the model silently ignores one. */
  const resolveModalities = (p: ModelProfile): string[] | null => {
    const provider = credentials.getProvider(p.providerId);
    const effective = effectiveProviderId(p.providerId, provider, p.model);
    return catalog?.getModelInfo(effective, p.model)?.modalities?.input ?? null;
  };
  const dto = (p: ModelProfile) => ({
    ...profileDto(p),
    context_limit: resolveContext(p),
    input_modalities: resolveModalities(p),
  });
  return {
    providers(): Response {
      return json({ providers: credentials.listProviders().map(providerDto) });
    },

    profiles(): Response {
      const active = credentials.getActiveProfile();
      return json({ profiles: credentials.listProfiles().map(dto), active_profile_id: active?.id ?? null });
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
      // Merge over any existing provider so a partial update (e.g. rotating just
      // the API key) preserves the fields the caller didn't send.
      const existing = credentials.getProvider(body.id);
      const type = body.type ?? existing?.type ?? (findKnownProvider(body.id) ? "known" : "custom");
      const provider: ProviderConfig = {
        ...(existing ?? {}),
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
      return json(dto(profile), 201);
    },

    /** Change a profile's reasoning effort in place — the web equivalent of the
     * TUI's `r` cycle. Because reasoning is part of the profile id, this swaps
     * the record (remove old, add new) while preserving its active state, so the
     * model stays a single list entry instead of accumulating duplicates. */
    async setReasoning(id, req): Promise<Response> {
      const profile = credentials.getProfile(id);
      if (!profile) return errorJson("not_found", `Profile ${id} not found`, 404);
      let body: { reasoning?: ReasoningConfig | null };
      try {
        body = await readJson(req);
      } catch {
        return errorJson("bad_request", "Invalid JSON body", 400);
      }
      const reasoning = normaliseReasoning(body.reasoning ?? { kind: "off" });
      const newId = CredentialsStore.makeProfileId(profile.providerId, profile.model, reasoning);
      const wasActive = credentials.getActiveProfile()?.id === id;
      const updated: ModelProfile = {
        ...profile,
        id: newId,
        reasoning: reasoning.kind === "off" ? undefined : reasoning,
      };
      if (newId !== id) credentials.removeProfile(id);
      credentials.upsertProfile(updated);
      if (wasActive) credentials.setActive(newId);
      return json(dto(updated));
    },

    deleteProfile(id): Response {
      if (!credentials.getProfile(id)) return errorJson("not_found", `Profile ${id} not found`, 404);
      credentials.removeProfile(id);
      return noContent();
    },

    /** Live model list straight from the provider's own API (GET {base}/models),
     * fetched server-side so the stored key never reaches the browser. Lets the
     * dashboard offer current models instead of the static catalog snapshot. */
    async listProviderModels(id): Promise<Response> {
      const provider = credentials.getProvider(id);
      if (!provider) return errorJson("not_found", `Provider ${id} not found`, 404);
      const effective = effectiveProviderId(id, provider);
      const known = findKnownProvider(effective);
      const apiKey = provider.apiKey ?? (known?.envVar ? process.env[known.envVar] : undefined);
      const baseURL = (provider.baseURL ?? defaultBaseURLFor(effective)).replace(/\/+$/, "");
      // Anthropic authenticates with x-api-key + a version header; everything
      // else in the catalog speaks OpenAI-style Bearer.
      const headers: Record<string, string> =
        effective === "anthropic"
          ? { "x-api-key": apiKey ?? "", "anthropic-version": "2023-06-01" }
          : { authorization: `Bearer ${apiKey ?? ""}` };
      try {
        const res = await fetch(`${baseURL}/models`, { headers, signal: AbortSignal.timeout(8000) });
        if (!res.ok) {
          return errorJson("upstream_error", `Provider responded ${res.status} to ${baseURL}/models`, 502);
        }
        const data: unknown = await res.json();
        const rows = Array.isArray((data as any)?.data)
          ? (data as any).data
          : Array.isArray((data as any)?.models)
            ? (data as any).models
            : [];
        const models = [
          ...new Set(
            rows
              .map((m: unknown) => (typeof m === "string" ? m : ((m as any)?.id ?? (m as any)?.name)))
              .filter((x: unknown): x is string => typeof x === "string" && x.length > 0),
          ),
        ];
        // OpenRouter (and compatible routers) annotate each model with its
        // architecture — surface input modalities when present so pickers can
        // badge vision-capable models. Other providers omit this; the catalog
        // covers known models by name as the fallback.
        const modalities: Record<string, string[]> = {};
        for (const row of rows) {
          const id = (row as any)?.id;
          const arch = (row as any)?.architecture;
          const input = Array.isArray(arch?.input_modalities)
            ? arch.input_modalities
            : typeof arch?.modality === "string"
              ? arch.modality.split("->")[0]?.split("+")
              : null;
          if (typeof id === "string" && Array.isArray(input) && input.length) {
            modalities[id] = input.filter((x: unknown): x is string => typeof x === "string");
          }
        }
        return json({ models, ...(Object.keys(modalities).length ? { modalities } : {}) });
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        return errorJson("upstream_unreachable", `Could not reach ${baseURL}/models — ${detail}`, 502);
      }
    },
  };
}
