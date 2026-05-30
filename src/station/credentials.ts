/**
 * Per-session credentials: the Station-wide CredentialsStore (read from disk)
 * with an optional in-memory overlay for a session's custom API key.
 *
 * The overlay is NEVER flushed to disk (open question 7, recommendation b):
 * the custom key lives only in this object for the life of the session. All
 * reads delegate to the base store except the overlaid provider/profile, and
 * `setActive` is in-memory so one session can't change the Station default.
 */

import { CredentialsStore, findKnownProvider } from "../agent/credentials.ts";
import type { ProviderConfig, ModelProfile } from "../agent/credentials.ts";
import type { SessionCredential } from "./types.ts";

export interface SessionCredentialsInit {
  custom?: SessionCredential | null;
  profileId?: string;
}

export class SessionCredentialsStore extends CredentialsStore {
  private overlayProvider: ProviderConfig | null = null;
  private overlayProfile: ModelProfile | null = null;
  private activeId: string | undefined;

  constructor(dataDir: string, init: SessionCredentialsInit = {}) {
    super(dataDir);
    this.activeId = init.profileId ?? super.getActiveProfile()?.id;
    if (init.custom) this.setCustom(init.custom);
  }

  /** Install or replace the custom credential. Returns the profile id to use. */
  setCustom(cred: SessionCredential): string {
    const known = findKnownProvider(cred.provider);
    const model = cred.model ?? known?.defaultModels[0];
    if (!model) {
      throw new Error(`Custom credential for provider '${cred.provider}' requires a model`);
    }
    this.overlayProvider = known
      ? { type: "known", id: cred.provider, apiKey: cred.apiKey }
      : { type: "custom", id: cred.provider, adapter: "openai-compat", apiKey: cred.apiKey };
    const id = `session__${cred.provider}__${model}`.replace(/[^a-zA-Z0-9_-]/g, "-");
    this.overlayProfile = {
      id,
      label: `${cred.provider} · ${model} (session)`,
      providerId: cred.provider,
      model,
    };
    this.activeId = id;
    return id;
  }

  /** Drop the custom credential. Returns the station profile id to revert to. */
  clearCustom(): string | undefined {
    this.overlayProvider = null;
    this.overlayProfile = null;
    this.activeId = super.getActiveProfile()?.id;
    return this.activeId;
  }

  /** Active Station profile, ignoring the session custom-key overlay. */
  stationDefaultProfileId(): string | undefined {
    return super.getActiveProfile()?.id;
  }

  override getProvider(id: string): ProviderConfig | undefined {
    if (this.overlayProvider && id === this.overlayProvider.id) return this.overlayProvider;
    return super.getProvider(id);
  }

  override getProfile(id: string): ModelProfile | undefined {
    if (this.overlayProfile && id === this.overlayProfile.id) return this.overlayProfile;
    return super.getProfile(id);
  }

  override getActiveProfile(): ModelProfile | undefined {
    if (this.activeId) return this.getProfile(this.activeId);
    return super.getActiveProfile();
  }

  override setActive(id: string): void {
    // In-memory only — a session must not rewrite the shared credentials file.
    this.activeId = id;
  }

  override listProfiles(): ModelProfile[] {
    const base = super.listProfiles();
    return this.overlayProfile ? [this.overlayProfile, ...base] : base;
  }

  override listProviders(): ProviderConfig[] {
    const base = super.listProviders();
    return this.overlayProvider ? [this.overlayProvider, ...base] : base;
  }
}
