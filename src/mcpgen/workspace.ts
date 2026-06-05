import { rmSync } from "node:fs";
import { join } from "node:path";
import { generateProvider } from "./generate.ts";
import { introspectToken, readSecretKeys, removeSecretKeys } from "./keys.ts";
import { listToolsViaMcp } from "./introspect.ts";
import { readManifest, writeManifest } from "./manifest.ts";
import type { ProviderSpec, SyncDiff, ToolDef } from "./types.ts";

/** Injectable tool lister so tests can drive the engine without the network. */
export type ToolLister = (url: string, token: string, provider: string) => Promise<ToolDef[]>;

/** Install or refresh a provider from a full spec (introspect → generate). */
export async function addProvider(
  workspaceDir: string,
  spec: ProviderSpec,
  lister: ToolLister = listToolsViaMcp,
): Promise<SyncDiff> {
  validateSpec(spec);
  const tools = await lister(spec.url, introspectToken(spec), spec.provider);
  return generateProvider(workspaceDir, spec, tools);
}

/** Re-introspect one already-installed provider and regenerate it. */
export async function syncProvider(
  workspaceDir: string,
  provider: string,
  lister: ToolLister = listToolsViaMcp,
): Promise<SyncDiff> {
  return addProvider(workspaceDir, specFromDisk(workspaceDir, provider), lister);
}

/** Sync every installed provider; one failure doesn't abort the rest. */
export async function syncAll(workspaceDir: string, lister: ToolLister = listToolsViaMcp): Promise<SyncDiff[]> {
  const providers = Object.keys(readManifest(workspaceDir).providers);
  const diffs: SyncDiff[] = [];
  for (const provider of providers) {
    try {
      diffs.push(await syncProvider(workspaceDir, provider, lister));
    } catch (err) {
      diffs.push({ provider, added: [], removed: [], changed: [], unchanged: 0, error: errMessage(err) });
    }
  }
  return diffs;
}

/** Remove a provider: delete its folder, manifest entry, and keys. */
export function removeProvider(workspaceDir: string, provider: string): void {
  const manifest = readManifest(workspaceDir);
  if (!manifest.providers[provider]) return;
  delete manifest.providers[provider];
  writeManifest(workspaceDir, manifest);
  removeSecretKeys(workspaceDir, provider);
  rmSync(join(workspaceDir, "mcp", provider), { recursive: true, force: true });
}

/** Rebuild a spec from the on-disk manifest (public) + keyfile (tokens). */
function specFromDisk(workspaceDir: string, provider: string): ProviderSpec {
  const pm = readManifest(workspaceDir).providers[provider];
  if (!pm) throw new Error(`Provider "${provider}" is not installed`);
  const secret = readSecretKeys(workspaceDir)[provider];
  if (!secret) throw new Error(`No keys for provider "${provider}"`);
  const identities = pm.identities.map((i) => {
    const token = secret.identities[i.name]?.token;
    if (!token) throw new Error(`Missing token for identity "${i.name}" of "${provider}"`);
    return { name: i.name, label: i.label, token };
  });
  return { provider, url: pm.url, identities, defaultIdentity: pm.defaultIdentity };
}

function validateSpec(spec: ProviderSpec): void {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(spec.provider)) throw new Error(`Invalid provider name: "${spec.provider}"`);
  if (!/^https?:\/\//.test(spec.url)) throw new Error(`Invalid MCP url: "${spec.url}"`);
  if (spec.identities.length === 0) throw new Error(`Provider "${spec.provider}" needs at least one identity`);
  const names = new Set<string>();
  for (const id of spec.identities) {
    if (!id.name || !id.token) throw new Error("Each identity needs a name and token");
    if (names.has(id.name)) throw new Error(`Duplicate identity name: "${id.name}"`);
    names.add(id.name);
  }
  if (spec.defaultIdentity && !names.has(spec.defaultIdentity)) {
    throw new Error(`Default identity "${spec.defaultIdentity}" is not among the identities`);
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
