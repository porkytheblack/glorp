import {
  CredentialsStore,
  CUSTOM_PROVIDER_ADAPTERS,
  findKnownProvider,
  reasoningKindFor,
  reasoningProviderId,
  type CustomProviderAdapter,
  type ModelProfile,
  type ReasoningConfig,
} from "../../agent/credentials.ts";

/**
 * Save the picked profile and bulk-create one profile per other model the
 * provider knows about. The picked model becomes active; the rest are
 * available immediately in Ctrl+M without a second onboarding pass.
 *
 * Reasoning config is only applied to models that actually accept the same
 * `reasoning.kind` — picking "high effort" for GPT-5 won't propagate to
 * GPT-4.1 (which doesn't accept effort hints).
 */
export function finalize(
  credentials: CredentialsStore,
  providerId: string,
  model: string,
  reasoning: ReasoningConfig,
  onComplete: (p: ModelProfile) => void,
): void {
  const known = findKnownProvider(providerId);
  const provider = credentials.getProvider(providerId);
  const customDefaults =
    provider?.type === "custom" && provider.adapter === "mimo"
      ? (findKnownProvider("mimo")?.defaultModels ?? [])
      : [];
  const effectiveReasoningId = reasoningProviderId(providerId, provider);
  const allModels = new Set<string>([model, ...(known?.defaultModels ?? []), ...customDefaults]);
  let activeProfile: ModelProfile | null = null;
  const now = new Date().toISOString();

  for (const m of allModels) {
    const isChosen = m === model;
    const supports = reasoningKindFor(effectiveReasoningId, m);
    const matchesKind = reasoning.kind !== "off" && supports !== null && supports === reasoning.kind;
    const r: ReasoningConfig = isChosen ? reasoning : matchesKind ? reasoning : { kind: "off" };
    const id = CredentialsStore.makeProfileId(providerId, m, r);
    const shortName = m.split("/").at(-1) ?? m;
    const labelSuffix = r.kind === "off" ? "" : ` · ${reasoningLabelFor(r)}`;
    const profile: ModelProfile = {
      id,
      label: `${providerId} · ${shortName}${labelSuffix}`,
      providerId,
      model: m,
      reasoning: r,
      lastUsedAt: isChosen ? now : undefined,
    };
    credentials.upsertProfile(profile);
    if (isChosen) activeProfile = profile;
  }
  if (activeProfile) {
    credentials.setActive(activeProfile.id);
    onComplete(activeProfile);
  }
}

export function reasoningLabelFor(r: ReasoningConfig): string {
  if (r.kind === "off") return "off";
  if (r.kind === "effort") return r.effort;
  if (r.kind === "thinking") return `${r.budget_tokens}b`;
  if (r.kind === "reasoningObject") return r.effort;
  if (r.kind === "qwenThinking") return r.enabled ? "on" : "off";
  return "";
}

export function adapterLabel(adapter: CustomProviderAdapter | undefined): string {
  return CUSTOM_PROVIDER_ADAPTERS.find((a) => a.id === (adapter ?? "openai-compat"))?.label
    ?? "OpenAI-compatible";
}
