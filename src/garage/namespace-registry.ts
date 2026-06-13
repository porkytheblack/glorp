/**
 * Resolves a request to a per-namespace BUNDLE — the SessionManager, workspace
 * store, credentials store, and route groups rooted at that namespace's data
 * subtree. Bundles are built lazily on first touch and cached, so a namespace's
 * manager only ever scans its own `<dataDir>/namespaces/<id>/` (or the legacy
 * root for `default`). This is the single layer that turns the otherwise
 * single-tenant Garage into a multi-tenant one.
 */

import { SessionManager } from "./manager.ts";
import { WorkspaceStore } from "./workspace-store.ts";
import { TaskStore } from "./task-store.ts";
import { NamespaceCredentialsStore } from "./credentials.ts";
import { buildRouteGroups, type RouteGroups } from "./route-groups.ts";
import { provision, type ProvisionContext } from "./templates/engine.ts";
import { TemplateError } from "./templates/types.ts";
import { selectNamespaceId } from "./auth/middleware.ts";
import { gitTokenSourceFor } from "./git-tokens.ts";
import { addProvider, listToolsViaMcp } from "../mcpgen/index.ts";
import type { NamespaceStore } from "./namespace-store.ts";
import type { GarageConfig } from "./config.ts";
import type { TemplateSource } from "./templates/source.ts";
import type { CredentialsStore } from "../agent/credentials.ts";
import type { UploadsSync } from "./storage/types.ts";
import type { Namespace, ProvisionMcpInput } from "./types.ts";
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
  tasks: TaskStore;
  credentials: CredentialsStore;
  routes: RouteGroups;
}

export class NamespaceRegistry {
  private readonly cache = new Map<string, NamespaceBundle>();
  /** Ids being deprovisioned — resolve() refuses to (re)build a bundle for these. */
  private readonly deleting = new Set<string>();

  /** Shared by every namespace — templates and uploads sync are garage-global. */
  private readonly provisionCtx: ProvisionContext;

  constructor(
    private readonly store: NamespaceStore,
    private readonly config: GarageConfig,
    private readonly templates: TemplateSource,
    /** Garage-default credentials, shared as the fallback for every namespace. */
    private readonly garageCredentials: CredentialsStore,
    /** Remote uploads mirror (R2); undefined when unconfigured. */
    private readonly uploadsSync?: UploadsSync,
  ) {
    this.provisionCtx = {
      templatesDir: config.templatesDir,
      gitTokens: gitTokenSourceFor(config),
      provisionMcp: async (workspace, input) => {
        await addProvider(workspace, { identities: [], ...input } as ProvisionMcpInput, listToolsViaMcp);
      },
    };
  }

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
    const tasks = new TaskStore(ns.dataDir);
    // The default namespace shares the garage credentials instance outright so
    // its writes and the tenant fallback reads never see a stale in-memory copy.
    const credentials: CredentialsStore = this.store.isDefault(ns.id)
      ? this.garageCredentials
      : new NamespaceCredentialsStore(ns.dataDir, this.garageCredentials);
    const manager = new SessionManager({
      dataDir: ns.dataDir,
      workspaceRoot: ns.workspaceRoot,
      nsId: ns.id,
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
        provision: async (name, params, workspace) => {
          const template = await this.templates.get(name);
          // has() raced a registry change — surface it as a template error.
          if (!template) throw new TemplateError(`Unknown template: ${name}`);
          return provision(template, params, workspace, this.provisionCtx);
        },
      },
    });
    return {
      ns,
      manager,
      workspaces,
      tasks,
      credentials,
      routes: buildRouteGroups(manager, this.config, credentials, ns.id, tasks, this.templates, this.uploadsSync),
    };
  }
}
