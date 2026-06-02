/**
 * Persisted registry of tenant namespaces at `<dataDir>/namespaces.json`.
 *
 * A namespace is an isolated data partition: its own `dataDir` subtree (under
 * `<stationDataDir>/namespaces/<id>/`) and its own sandbox `workspaceRoot`. The
 * reserved `default` namespace is SYNTHESIZED, never written to the file — its
 * paths point at the station's legacy roots, so an existing single-tenant
 * install (which has no `namespaces.json` at all) keeps working untouched.
 *
 * The namespace id is interpolated directly into filesystem paths, so id
 * validation here is a security boundary (no `/`, `.`, `..`, or traversal).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Namespace } from "./types.ts";

/** The reserved, always-present namespace mapped to the station's legacy roots. */
export const DEFAULT_NAMESPACE_ID = "default";

/** Full ids look like `ns_<slug>`, kept short enough to be a safe path segment. */
const ID_RE = /^ns_[a-z0-9][a-z0-9-]{0,59}$/;

export class NamespaceError extends Error {}

interface NamespacesFile {
  version: 1;
  namespaces: Record<string, Namespace>;
}

/** Lowercase, hyphenate, and trim a name into a path-safe slug. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 59);
}

export class NamespaceStore {
  private readonly filePath: string;
  private data: NamespacesFile;

  constructor(
    private readonly stationDataDir: string,
    private readonly stationWorkspaceRoot: string,
  ) {
    fs.mkdirSync(stationDataDir, { recursive: true });
    this.filePath = path.join(stationDataDir, "namespaces.json");
    this.data = this.load();
  }

  private load(): NamespacesFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as NamespacesFile;
      if (parsed?.version === 1 && parsed.namespaces && typeof parsed.namespaces === "object") {
        return parsed;
      }
    } catch {
      /* missing or malformed — start fresh */
    }
    return { version: 1, namespaces: {} };
  }

  private flush(): void {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
  }

  /** The synthesized `default` namespace — legacy roots, never persisted. */
  private defaultNamespace(): Namespace {
    return {
      id: DEFAULT_NAMESPACE_ID,
      name: "Default",
      slug: DEFAULT_NAMESPACE_ID,
      createdAt: new Date(0).toISOString(),
      dataDir: this.stationDataDir,
      workspaceRoot: this.stationWorkspaceRoot,
    };
  }

  /** All namespaces: the synthesized `default` first, then persisted ones by name. */
  list(): Namespace[] {
    const tenants = Object.values(this.data.namespaces).sort((a, b) => a.name.localeCompare(b.name));
    return [this.defaultNamespace(), ...tenants];
  }

  get(id: string): Namespace | undefined {
    if (id === DEFAULT_NAMESPACE_ID) return this.defaultNamespace();
    return this.data.namespaces[id];
  }

  isDefault(id: string): boolean {
    return id === DEFAULT_NAMESPACE_ID;
  }

  /** Register a new tenant namespace. Throws on bad slug / reserved id / collision. */
  create(input: { name: string; slug?: string }): Namespace {
    const name = input.name?.trim();
    if (!name) throw new NamespaceError("A namespace 'name' is required");
    const base = slugify(input.slug ?? name);
    if (!base) throw new NamespaceError("Could not derive a valid slug from the name");
    const slug = this.uniqueSlug(base);
    const id = `ns_${slug}`;
    if (!ID_RE.test(id)) throw new NamespaceError(`Invalid namespace id: ${id}`);
    const ns: Namespace = {
      id,
      name,
      slug,
      createdAt: new Date().toISOString(),
      dataDir: path.join(this.stationDataDir, "namespaces", id),
      workspaceRoot: path.join(this.stationWorkspaceRoot, id),
    };
    this.data.namespaces[id] = ns;
    this.flush();
    return ns;
  }

  /** Suffix `-2`, `-3`, … until `ns_<slug>` is free (also skips the reserved id). */
  private uniqueSlug(base: string): string {
    let candidate = base;
    let n = 2;
    while (this.data.namespaces[`ns_${candidate}`] || candidate === DEFAULT_NAMESPACE_ID) {
      const suffix = `-${n++}`;
      candidate = base.slice(0, 59 - suffix.length) + suffix;
    }
    return candidate;
  }

  /** Remove a tenant namespace record. Refuses the reserved `default`. */
  delete(id: string): boolean {
    if (id === DEFAULT_NAMESPACE_ID) throw new NamespaceError("Cannot delete the default namespace");
    if (!this.data.namespaces[id]) return false;
    delete this.data.namespaces[id];
    this.flush();
    return true;
  }
}
