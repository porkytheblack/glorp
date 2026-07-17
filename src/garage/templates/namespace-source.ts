/**
 * A single namespace's template library: the tenant's own on-disk templates
 * layered over the garage-global catalog. A tenant template WINS on a name
 * collision, so every namespace inherits the whole garage catalog and may add
 * to it or override an entry by name — "inherit-and-override".
 *
 * `resolve()` also reports which directory a template came from, so the engine
 * resolves a template's bundled `skill.from` sources under the right root: the
 * tenant's dir for tenant-owned templates, the garage dir for inherited ones.
 *
 * Backward compatible by construction: pass `tenantDir: null` (the default
 * namespace) and this degenerates to the garage source unchanged; a tenant with
 * no templates dir yet lists an empty local set and so inherits the full garage
 * catalog exactly as before the per-namespace layer existed.
 */

import type { Template } from "./types.ts";
import type { TemplateSource } from "./source.ts";
import { TemplateStore } from "./store.ts";

/** A template plus the templates dir it resolved from (for `skill.from`). */
export interface ResolvedTemplate {
  template: Template;
  templatesDir: string;
}

export interface NamespaceTemplateSource extends TemplateSource {
  /** The template plus its origin dir, or undefined when the name is unknown. */
  resolve(name: string): Promise<ResolvedTemplate | undefined>;
}

/**
 * Build a namespace's template source. `tenantDir` is the namespace's own
 * `<dataDir>/templates` (or null for the default namespace, which owns the
 * garage library directly). `garage` is the shared garage-global source and
 * `garageDir` its on-disk root — the origin reported for inherited templates.
 */
export function namespaceTemplateSource(
  tenantDir: string | null,
  garage: TemplateSource,
  garageDir: string,
): NamespaceTemplateSource {
  const tenant = tenantDir ? new TemplateStore(tenantDir) : null;

  return {
    async list(): Promise<Template[]> {
      if (!tenant) return garage.list();
      const local = tenant.list();
      const own = new Set(local.map((t) => t.name));
      const inherited = (await garage.list()).filter((t) => !own.has(t.name));
      return [...local, ...inherited].sort((a, b) => a.name.localeCompare(b.name));
    },

    async get(name: string): Promise<Template | undefined> {
      return tenant?.get(name) ?? (await garage.get(name));
    },

    async has(name: string): Promise<boolean> {
      return (tenant?.has(name) ?? false) || (await garage.has(name));
    },

    async resolve(name: string): Promise<ResolvedTemplate | undefined> {
      const local = tenant?.get(name);
      if (local && tenantDir) return { template: local, templatesDir: tenantDir };
      const inherited = await garage.get(name);
      return inherited ? { template: inherited, templatesDir: garageDir } : undefined;
    },
  };
}
