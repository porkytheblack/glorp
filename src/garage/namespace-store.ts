/**
 * Persisted registry of tenant namespaces at `<dataDir>/namespaces.json`.
 *
 * A namespace is an isolated data partition: its own `dataDir` subtree (under
 * `<garageDataDir>/namespaces/<id>/`) and its own sandbox `workspaceRoot`. The
 * reserved `default` namespace is SYNTHESIZED, never written to the file — its
 * paths point at the garage's legacy roots, so an existing single-tenant
 * install (which has no `namespaces.json` at all) keeps working untouched.
 *
 * The namespace id is interpolated directly into filesystem paths, so id
 * validation here is a security boundary (no `/`, `.`, `..`, or traversal).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Namespace, NamespaceTemplateRegistry } from "./types.ts";

/** The reserved, always-present namespace mapped to the garage's legacy roots. */
export const DEFAULT_NAMESPACE_ID = "default";

/** Full ids look like `ns_<slug>`, kept short enough to be a safe path segment. */
const ID_RE = /^ns_[a-z0-9][a-z0-9-]{0,59}$/;

export class NamespaceError extends Error {}

interface NamespacesFile {
  version: 1;
  namespaces: Record<string, Namespace>;
}

/**
 * Validate/normalize a companion registry config from an untrusted source. In
 * `strict` mode (a create request) a malformed URL throws so the caller learns
 * their config is bad; when loading persisted data it's lenient (drop a corrupt
 * registry, keep the namespace) — a bad companion must never orphan a tenant.
 * Non-string header values are dropped either way.
 */
export function normalizeRegistry(raw: unknown, strict: boolean): NamespaceTemplateRegistry | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") {
    if (strict) throw new NamespaceError("'template_registry' must be an object");
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  const url = typeof r.url === "string" ? r.url.trim() : "";
  let ok = false;
  try {
    const u = new URL(url);
    ok = u.protocol === "http:" || u.protocol === "https:";
  } catch {
    ok = false;
  }
  if (!ok) {
    if (strict) throw new NamespaceError("'template_registry.url' must be an http(s) URL");
    return undefined;
  }
  const headers: Record<string, string> = {};
  if (r.headers && typeof r.headers === "object" && !Array.isArray(r.headers)) {
    for (const [k, v] of Object.entries(r.headers as Record<string, unknown>)) {
      if (typeof v === "string") headers[k] = v;
    }
  }
  return { url, ...(Object.keys(headers).length ? { headers } : {}) };
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
    private readonly garageDataDir: string,
    private readonly garageWorkspaceRoot: string,
  ) {
    fs.mkdirSync(garageDataDir, { recursive: true });
    this.filePath = path.join(garageDataDir, "namespaces.json");
    this.data = this.load();
  }

  /** Canonical, id-derived paths for a tenant namespace (never trusted from disk). */
  private tenantPaths(id: string): { dataDir: string; workspaceRoot: string } {
    return {
      dataDir: path.join(this.garageDataDir, "namespaces", id),
      workspaceRoot: path.join(this.garageWorkspaceRoot, id),
    };
  }

  /**
   * Load the persisted registry. A genuinely-absent file (ENOENT) means a fresh,
   * single-tenant install → empty registry. ANY other failure (read error,
   * malformed JSON, bad shape, tampered/invalid id) is fatal rather than silently
   * resetting to empty — silently dropping the registry would orphan every tenant.
   * `dataDir`/`workspaceRoot` are always re-derived from the id, so hand-tampered
   * paths can't escape the canonical subtree and a relocated dataDir self-heals.
   */
  private load(): NamespacesFile {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, namespaces: {} };
      throw err;
    }
    const parsed = JSON.parse(raw) as NamespacesFile; // malformed JSON → throw
    if (parsed?.version !== 1 || !parsed.namespaces || typeof parsed.namespaces !== "object") {
      throw new NamespaceError(`Corrupt namespaces file: ${this.filePath}`);
    }
    const namespaces: Record<string, Namespace> = {};
    for (const [id, ns] of Object.entries(parsed.namespaces)) {
      if (id === DEFAULT_NAMESPACE_ID || !ID_RE.test(id)) {
        throw new NamespaceError(`Invalid namespace id in ${this.filePath}: ${id}`);
      }
      const paths = this.tenantPaths(id);
      // Trust nothing but the id: coerce name to a string, derive slug from the
      // id (ignore any persisted slug), and validate createdAt is a real ISO
      // date — so list()/sort and callers always get well-typed fields.
      const createdAt = ns?.createdAt;
      const registry = normalizeRegistry((ns as { templateRegistry?: unknown })?.templateRegistry, false);
      namespaces[id] = {
        id,
        name: typeof ns?.name === "string" ? ns.name : id,
        slug: id.slice("ns_".length),
        createdAt:
          typeof createdAt === "string" && !Number.isNaN(Date.parse(createdAt))
            ? createdAt
            : new Date(0).toISOString(),
        dataDir: paths.dataDir,
        workspaceRoot: paths.workspaceRoot,
        ...(registry ? { templateRegistry: registry } : {}),
      };
    }
    return { version: 1, namespaces };
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
      dataDir: this.garageDataDir,
      workspaceRoot: this.garageWorkspaceRoot,
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
  create(input: { name: string; slug?: string; template_registry?: unknown }): Namespace {
    const name = input.name?.trim();
    if (!name) throw new NamespaceError("A namespace 'name' is required");
    const base = slugify(input.slug ?? name);
    if (!base) throw new NamespaceError("Could not derive a valid slug from the name");
    // Validate the companion registry up front (strict) so a bad URL is a 400,
    // not a silently-dropped config discovered only on the next provision.
    const templateRegistry = normalizeRegistry(input.template_registry, true);
    const slug = this.uniqueSlug(base);
    const id = `ns_${slug}`;
    if (!ID_RE.test(id)) throw new NamespaceError(`Invalid namespace id: ${id}`);
    const ns: Namespace = {
      id,
      name,
      slug,
      createdAt: new Date().toISOString(),
      ...this.tenantPaths(id),
      ...(templateRegistry ? { templateRegistry } : {}),
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
