import { chmodSync } from "node:fs";
import { join } from "node:path";
import { readIfExists, writeIfChanged } from "./fsutil.ts";
import type { ProviderSpec } from "./types.ts";

interface ProviderKeys {
  default?: string;
  identities: Record<string, { token: string }>;
}
type SecretFile = Record<string, ProviderKeys>;

export function keyfilePath(workspaceDir: string): string {
  return join(workspaceDir, ".secrets", "keys.json");
}

export function readSecretKeys(workspaceDir: string): SecretFile {
  return parse(readIfExists(keyfilePath(workspaceDir)));
}

/** Merge a provider's identities into the 0600 secret keyfile. */
export function writeSecretKeys(workspaceDir: string, spec: ProviderSpec): void {
  const all = readSecretKeys(workspaceDir);
  const identities: Record<string, { token: string }> = {};
  for (const id of spec.identities) identities[id.name] = { token: id.token };
  all[spec.provider] = { default: spec.defaultIdentity, identities };
  flush(workspaceDir, all);
}

export function removeSecretKeys(workspaceDir: string, provider: string): void {
  const all = readSecretKeys(workspaceDir);
  if (!(provider in all)) return;
  delete all[provider];
  flush(workspaceDir, all);
}

/** Token used to introspect: the default identity, else the first. */
export function introspectToken(spec: ProviderSpec): string {
  const byName = new Map(spec.identities.map((i) => [i.name, i.token]));
  const token =
    (spec.defaultIdentity ? byName.get(spec.defaultIdentity) : undefined) ?? spec.identities[0]?.token;
  if (!token) throw new Error(`Provider "${spec.provider}" has no identities with tokens`);
  return token;
}

function flush(workspaceDir: string, all: SecretFile): void {
  const path = keyfilePath(workspaceDir);
  writeIfChanged(path, JSON.stringify(all, null, 2) + "\n", 0o600);
  try {
    chmodSync(path, 0o600);
  } catch {
    // best-effort on platforms without POSIX modes
  }
}

function parse(raw: string | null): SecretFile {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as SecretFile) : {};
  } catch {
    return {};
  }
}
