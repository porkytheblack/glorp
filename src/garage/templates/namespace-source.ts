/**
 * A single namespace's template library, layered newest-wins:
 *
 *   tenant disk  >  tenant companion  >  garage catalog (disk > garage companion)
 *
 * A namespace inherits the whole garage catalog and may add to it — or override
 * an entry by name — with its own on-disk templates and/or its own companion
 * registry (its own key/library). Within the namespace, an explicit on-disk
 * template wins over the dynamic companion one.
 *
 * `resolve()` also reports which directory a template came from, so the engine
 * resolves a template's bundled `skill.from` sources under the right root: the
 * tenant's dir for tenant-owned disk templates, the garage dir otherwise
 * (companion templates inline their files and don't use `skill.from`).
 *
 * Backward compatible: pass `tenantDir: null` and no `tenantRemote` (the default
 * namespace) and this degenerates to the garage source unchanged; a tenant with
 * neither a templates dir nor a companion inherits the full garage catalog.
 */

import type { Template } from "./types.ts";
import type { TemplateSource } from "./source.ts";
import { TemplateStore } from "./store.ts";

/** A template plus the templates dir it resolved from (for `skill.from`). */
export interface ResolvedTemplate {
  template: Template;
  templatesDir: string;
}

/** The read surface a companion registry exposes (see RemoteTemplateRegistry). */
export interface RemoteLike {
  list(): Promise<Template[]>;
  get(name: string): Promise<Template | undefined>;
}

export interface NamespaceTemplateSource extends TemplateSource {
  /** The template plus its origin dir, or undefined when the name is unknown. */
  resolve(name: string): Promise<ResolvedTemplate | undefined>;
}

/**
 * Build a namespace's template source. `tenantDir` is the namespace's own
 * `<dataDir>/templates` (or null for the default namespace). `garage` is the
 * shared garage-global source and `garageDir` its on-disk root — the origin
 * reported for inherited and companion templates. `tenantRemote` is the
 * namespace's own companion registry, when configured.
 */
export function namespaceTemplateSource(
  tenantDir: string | null,
  garage: TemplateSource,
  garageDir: string,
  tenantRemote?: RemoteLike | null,
): NamespaceTemplateSource {
  const tenant = tenantDir ? new TemplateStore(tenantDir) : null;

  return {
    async list(): Promise<Template[]> {
      if (!tenant && !tenantRemote) return garage.list();
      const seen = new Set<string>();
      const out: Template[] = [];
      const add = (templates: Template[]) => {
        for (const t of templates) {
          if (seen.has(t.name)) continue;
          seen.add(t.name);
          out.push(t);
        }
      };
      add(tenant?.list() ?? []); // tenant disk wins
      if (tenantRemote) add(await tenantRemote.list()); // then tenant companion
      add(await garage.list()); // then the inherited garage catalog
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },

    async get(name: string): Promise<Template | undefined> {
      return tenant?.get(name) ?? (tenantRemote ? await tenantRemote.get(name) : undefined) ?? (await garage.get(name));
    },

    async has(name: string): Promise<boolean> {
      if (tenant?.has(name)) return true;
      if (tenantRemote && (await tenantRemote.get(name))) return true;
      return garage.has(name);
    },

    async resolve(name: string): Promise<ResolvedTemplate | undefined> {
      const disk = tenant?.get(name);
      if (disk && tenantDir) return { template: disk, templatesDir: tenantDir };
      const remote = tenantRemote ? await tenantRemote.get(name) : undefined;
      if (remote) return { template: remote, templatesDir: garageDir };
      const inherited = await garage.get(name);
      return inherited ? { template: inherited, templatesDir: garageDir } : undefined;
    },
  };
}
