/**
 * Per-session credentials: the namespace's CredentialsStore (read from disk)
 * with an optional in-memory overlay for a session's custom API key, layered
 * over the station's default credentials as a fallback.
 *
 * The overlay is NEVER flushed to disk (open question 7, recommendation b):
 * the custom key lives only in this object for the life of the session. All
 * reads delegate to the namespace store (then the station fallback) except the
 * overlaid provider/profile, and `setActive` is in-memory so one session can't
 * change the namespace default. Effective precedence:
 *   session custom key  >  namespace credentials  >  station credentials
 */

import { CredentialsStore, findKnownProvider } from "../agent/credentials.ts";
import type { ProviderConfig, ModelProfile } from "../agent/credentials.ts";
import type { SessionCredential } from "./types.ts";

/**
 * A namespace-scoped credentials store: reads/writes its own
 * `<nsDataDir>/credentials.json`, but on a read miss falls back to the station's
 * default store. Writes only ever touch the namespace file. The fallback is
 * skipped when `base` is absent or points at the same file (the `default`
 * namespace), so default-namespace behavior is byte-for-byte unchanged.
 */
export class NamespaceCredentialsStore extends CredentialsStore {
  protected readonly base: CredentialsStore | null;

  constructor(nsDataDir: string, base?: CredentialsStore | null) {
    super(nsDataDir);
    this.base = base && base.filePath !== this.filePath ? base : null;
  }

  override getProvider(id: string): ProviderConfig | undefined {
    return super.getProvider(id) ?? this.base?.getProvider(id);
  }

  override getProfile(id: string): ModelProfile | undefined {
    return super.getProfile(id) ?? this.base?.getProfile(id);
  }

  override getActiveProfile(): ModelProfile | undefined {
    return super.getActiveProfile() ?? this.base?.getActiveProfile();
  }

  override listProviders(): ProviderConfig[] {
    return mergeById(super.listProviders(), this.base?.listProviders() ?? [], (p) => p.id);
  }

  override listProfiles(): ModelProfile[] {
    return mergeById(super.listProfiles(), this.base?.listProfiles() ?? [], (p) => p.id);
  }
}

/** Concatenate two lists, keeping the first occurrence of each id (ns wins). */
function mergeById<T>(primary: T[], fallback: T[], key: (x: T) => string): T[] {
  const seen = new Set(primary.map(key));
  return [...primary, ...fallback.filter((x) => !seen.has(key(x)))];
}

export interface SessionCredentialsInit {
  custom?: SessionCredential | null;
  profileId?: string;
}

export class SessionCredentialsStore extends NamespaceCredentialsStore {
  private overlayProvider: ProviderConfig | null = null;
  private overlayProfile: ModelProfile | null = null;
  private activeId: string | undefined;

  constructor(dataDir: string, init: SessionCredentialsInit = {}, base?: CredentialsStore | null) {
    super(dataDir, base);
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

  /**
   * Active namespace profile (falling back to the station default), ignoring the
   * session custom-key overlay. Used to revert when a custom key is cleared.
   */
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
