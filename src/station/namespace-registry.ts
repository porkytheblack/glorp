/**
 * Resolves a request to a per-namespace BUNDLE — the SessionManager, workspace
 * store, credentials store, and route groups rooted at that namespace's data
 * subtree. Bundles are built lazily on first touch and cached, so a namespace's
 * manager only ever scans its own `<dataDir>/namespaces/<id>/` (or the legacy
 * root for `default`). This is the single layer that turns the otherwise
 * single-tenant Station into a multi-tenant one.
 */

import { SessionManager } from "./manager.ts";
import { WorkspaceStore } from "./workspace-store.ts";
import { NamespaceCredentialsStore } from "./credentials.ts";
import { buildRouteGroups, type RouteGroups } from "./route-groups.ts";
import { provision } from "./templates/engine.ts";
import { selectNamespaceId } from "./auth/middleware.ts";
import type { NamespaceStore } from "./namespace-store.ts";
import type { StationConfig } from "./config.ts";
import type { TemplateStore } from "./templates/store.ts";
import type { CredentialsStore } from "../agent/credentials.ts";
import type { Namespace } from "./types.ts";
import type { ApiKey } from "./auth/types.ts";

export class NamespaceNotFoundError extends Error {
  constructor(nsId: string) {
    super(`Unknown namespace: ${nsId}`);
  }
}

export interface NamespaceBundle {
  ns: Namespace;
  manager: SessionManager;
  workspaces: WorkspaceStore;
  credentials: CredentialsStore;
  routes: RouteGroups;
}

export class NamespaceRegistry {
  private readonly cache = new Map<string, NamespaceBundle>();
  /** Ids being deprovisioned — resolve() refuses to (re)build a bundle for these. */
  private readonly deleting = new Set<string>();

  constructor(
    private readonly store: NamespaceStore,
    private readonly config: StationConfig,
    private readonly templates: TemplateStore,
    /** Station-default credentials, shared as the fallback for every namespace. */
    private readonly stationCredentials: CredentialsStore,
  ) {}

  /** Build-once + cache the bundle for a namespace id. Throws if it's unknown. */
  resolve(nsId: string): NamespaceBundle {
    // A deprovision in flight must not be resurrected by a racing request.
    if (this.deleting.has(nsId)) throw new NamespaceNotFoundError(nsId);
    const cached = this.cache.get(nsId);
    if (cached) return cached;
    const ns = this.store.get(nsId);
    if (!ns) throw new NamespaceNotFoundError(nsId);
    const bundle = this.build(ns);
    this.cache.set(nsId, bundle);
    return bundle;
  }

  /** Mark a namespace as deprovisioning so resolve() refuses to rebuild it. */
  beginDelete(nsId: string): void {
    this.deleting.add(nsId);
  }

  /** Clear the deprovisioning mark (call in a finally). */
  endDelete(nsId: string): void {
    this.deleting.delete(nsId);
  }

  /** Resolve + authorize the namespace an authenticated request targets. */
  bundleForKey(key: ApiKey | null, requested: string | null): NamespaceBundle {
    return this.resolve(selectNamespaceId(key, requested));
  }

  /** Drop a cached bundle (after deprovision). Caller shuts it down first. */
  evict(nsId: string): NamespaceBundle | undefined {
    const bundle = this.cache.get(nsId);
    this.cache.delete(nsId);
    return bundle;
  }

  /** Every currently-built bundle (used to flush all managers on shutdown). */
  liveBundles(): NamespaceBundle[] {
    return [...this.cache.values()];
  }

  private build(ns: Namespace): NamespaceBundle {
    const workspaces = new WorkspaceStore(ns.dataDir);
    // The default namespace shares the station credentials instance outright so
    // its writes and the tenant fallback reads never see a stale in-memory copy.
    const credentials: CredentialsStore = this.store.isDefault(ns.id)
      ? this.stationCredentials
      : new NamespaceCredentialsStore(ns.dataDir, this.stationCredentials);
    const manager = new SessionManager({
      dataDir: ns.dataDir,
      workspaceRoot: ns.workspaceRoot,
      defaultProvider: this.config.defaultProvider,
      defaultModel: this.config.defaultModel,
      permissionMode: this.config.permissionMode,
      workspaces,
      fallbackDataDir: this.config.dataDir,
      // Tenant namespaces confine every session workspace to their own root;
      // the default namespace keeps the operator's attach-any-host-path power.
      confineWorkspaces: !this.store.isDefault(ns.id),
      templates: {
        has: (name) => this.templates.has(name),
        provision: (name, params, workspace) => provision(this.templates.get(name)!, params, workspace),
      },
    });
    return { ns, manager, workspaces, credentials, routes: buildRouteGroups(manager, this.config, credentials) };
  }
}
