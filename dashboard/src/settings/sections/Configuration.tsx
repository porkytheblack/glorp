/**
 * Configuration / Models — REAL. Two groups, both wired to the Station API:
 *   - Providers: list `api.providers()`, add a known/custom provider (picked
 *     from `api.catalog()`) via `api.addProvider`, remove via `deleteProvider`.
 *   - Profiles: list `api.profiles()`, mark the active Station default, switch
 *     it with `api.activateProfile`, add with `api.addProfile`, remove with
 *     `api.deleteProfile`.
 * Add-flow forms live in `models/AddForms.tsx`; the list rows in
 * `models/ModelRows.tsx`.
 */

import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontal, Plus } from "lucide-react";
import {
  api,
  type CatalogProvider,
  type ProfileSummary,
  type ProviderSummary,
} from "../../api/client.ts";
import { Button } from "@/components/ui/button.tsx";
import { AddProvider, AddProfile, LABEL } from "./models/AddForms.tsx";
import { ProviderRow, ProfileRow } from "./models/ModelRows.tsx";

function relTime(iso: string | null): string {
  if (!iso) return "never used";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "never used";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function Configuration() {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [catalog, setCatalog] = useState<CatalogProvider[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addProvider, setAddProvider] = useState(false);
  const [addProfile, setAddProfile] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [pv, pf, cat] = await Promise.all([api.providers(), api.profiles(), api.catalog()]);
      setProviders(pv.providers);
      setProfiles(pf.profiles);
      setActive(pf.active_profile_id);
      setCatalog(cat.providers);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setPending(key);
    setError(null);
    try { await fn(); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setPending(null); }
  };

  const removeProvider = (id: string) => {
    if (!window.confirm(`Remove provider "${id}"? Profiles using it may stop working.`)) return;
    void run(`pv:${id}`, () => api.deleteProvider(id));
  };
  const removeProfile = (id: string) => {
    if (!window.confirm("Remove this model profile?")) return;
    void run(`pf:${id}`, () => api.deleteProfile(id));
  };
  const activate = (id: string) =>
    void run(`act:${id}`, () => api.activateProfile(id).then((r) => setActive(r.active_profile_id)));

  return (
    <>
      <div>
        <div className="flex items-center gap-2.5">
          <SlidersHorizontal size={18} className="shrink-0 text-glorp-muted" strokeWidth={1.75} />
          <h2 className="text-lg font-semibold text-glorp-text">Models</h2>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-glorp-muted">
          Configure providers and model profiles. The Station default profile is used for new chats that
          don't pick their own model.
        </p>
      </div>

      {error && <p className="text-[13px] text-glorp-error">{error}</p>}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <span className={LABEL}>Providers</span>
          {!addProvider && (
            <Button variant="outline" size="sm" className="text-[12px]" onClick={() => setAddProvider(true)}>
              <Plus /> Add provider
            </Button>
          )}
        </div>
        {addProvider && (
          <AddProvider
            catalog={catalog}
            onAdded={() => void refresh()}
            onError={(m) => setError(m || null)}
            onClose={() => setAddProvider(false)}
          />
        )}
        {loading ? (
          <p className="text-[13px] text-glorp-muted">Loading providers…</p>
        ) : providers.length === 0 ? (
          <p className="text-[13px] text-glorp-muted">No providers configured yet.</p>
        ) : (
          <div className="space-y-1.5">
            {providers.map((pv) => (
              <ProviderRow key={pv.id} provider={pv} pending={pending === `pv:${pv.id}`} onDelete={removeProvider} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <span className={LABEL}>Profiles</span>
          {!addProfile && providers.length > 0 && (
            <Button variant="outline" size="sm" className="text-[12px]" onClick={() => setAddProfile(true)}>
              <Plus /> Add profile
            </Button>
          )}
        </div>
        {addProfile && (
          <AddProfile
            providers={providers}
            catalog={catalog}
            onAdded={() => void refresh()}
            onError={(m) => setError(m || null)}
            onClose={() => setAddProfile(false)}
          />
        )}
        {loading ? (
          <p className="text-[13px] text-glorp-muted">Loading profiles…</p>
        ) : profiles.length === 0 ? (
          <p className="text-[13px] text-glorp-muted">No model profiles configured on this Station.</p>
        ) : (
          <div className="space-y-1.5">
            {profiles.map((profile) => (
              <ProfileRow
                key={profile.id}
                profile={profile}
                isActive={profile.id === active}
                meta={relTime(profile.last_used_at)}
                activating={pending === `act:${profile.id}`}
                deleting={pending === `pf:${profile.id}`}
                onActivate={activate}
                onDelete={removeProfile}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
