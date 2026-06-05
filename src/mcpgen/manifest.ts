import { createHash } from "node:crypto";
import { join } from "node:path";
import { readIfExists, writeIfChanged } from "./fsutil.ts";
import { GENERATOR_VERSION } from "./types.ts";
import type { Manifest, ProviderManifest, ProviderSpec, ToolDef } from "./types.ts";

export function manifestPath(workspaceDir: string): string {
  return join(workspaceDir, "mcp", "manifest.json");
}

const EMPTY: Manifest = { version: 1, generator: GENERATOR_VERSION, providers: {} };

export function readManifest(workspaceDir: string): Manifest {
  const raw = readIfExists(manifestPath(workspaceDir));
  if (!raw) return structuredClone(EMPTY);
  try {
    const m = JSON.parse(raw) as Manifest;
    if (m?.version === 1 && m.providers && typeof m.providers === "object") return m;
  } catch {
    // fall through to empty
  }
  return structuredClone(EMPTY);
}

export function writeManifest(workspaceDir: string, manifest: Manifest): void {
  writeIfChanged(manifestPath(workspaceDir), JSON.stringify(manifest, null, 2) + "\n");
}

/** Stable hash of the tool surface — schema-sensitive, order-insensitive. */
export function hashTools(tools: ToolDef[]): string {
  const norm = [...tools]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ name: t.name, inputSchema: t.inputSchema }));
  const hex = createHash("sha256").update(JSON.stringify(norm)).digest("hex");
  return `sha256:${hex.slice(0, 32)}`;
}

/** Build the manifest record for a provider, preserving installedAt. */
export function providerEntry(spec: ProviderSpec, tools: ToolDef[], prev?: ProviderManifest): ProviderManifest {
  const now = new Date().toISOString();
  return {
    url: spec.url,
    defaultIdentity: spec.defaultIdentity,
    identities: spec.identities.map((i) => ({ name: i.name, label: i.label })),
    tools: tools.map((t) => t.name).sort(),
    toolsHash: hashTools(tools),
    installedAt: prev?.installedAt ?? now,
    syncedAt: now,
    generator: GENERATOR_VERSION,
  };
}
