/**
 * The async template surface the rest of Garage consumes — a merge of the
 * operator's on-disk library and the (optional) companion-service registry.
 * Disk WINS on a name collision: the operator's machine is authoritative over
 * the network (docs/companion-service-spec.md §3).
 */

import type { Template } from "./types.ts";
import type { TemplateStore } from "./store.ts";
import type { RemoteTemplateRegistry } from "./remote.ts";

export interface TemplateSource {
  list(): Promise<Template[]>;
  get(name: string): Promise<Template | undefined>;
  has(name: string): Promise<boolean>;
}

export function compositeTemplateSource(
  disk: TemplateStore,
  remote?: RemoteTemplateRegistry | null,
): TemplateSource {
  return {
    async list(): Promise<Template[]> {
      const local = disk.list();
      if (!remote) return local;
      const names = new Set(local.map((t) => t.name));
      const shadowed = (await remote.list()).filter((t) => !names.has(t.name));
      return [...local, ...shadowed].sort((a, b) => a.name.localeCompare(b.name));
    },

    async get(name: string): Promise<Template | undefined> {
      return disk.get(name) ?? (remote ? await remote.get(name) : undefined);
    },

    async has(name: string): Promise<boolean> {
      return disk.has(name) || (remote ? (await remote.get(name)) !== undefined : false);
    },
  };
}
