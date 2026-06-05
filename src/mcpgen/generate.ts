import { join } from "node:path";
import { removeIfExists, writeIfChanged } from "./fsutil.ts";
import { fileBase, renderBarrel, renderToolFile } from "./templates.ts";
import { writeEmittedClient } from "./emitted.ts";
import { writePublicDocs } from "./docs.ts";
import { writeSecretKeys } from "./keys.ts";
import { providerEntry, readManifest, writeManifest } from "./manifest.ts";
import { GENERATOR_VERSION } from "./types.ts";
import type { ProviderSpec, SyncDiff, ToolDef } from "./types.ts";

/**
 * Deterministically (re)generate one provider's folder from its tool list,
 * refresh secrets/manifest/docs, and return the tool-level diff. Unchanged
 * tool files are not rewritten, so a no-op regeneration reports no changes.
 */
export function generateProvider(workspaceDir: string, spec: ProviderSpec, tools: ToolDef[]): SyncDiff {
  const manifest = readManifest(workspaceDir);
  const prev = manifest.providers[spec.provider];
  const prevTools = new Set(prev?.tools ?? []);
  const providerDir = join(workspaceDir, "mcp", spec.provider);
  const diff: SyncDiff = { provider: spec.provider, added: [], removed: [], changed: [], unchanged: 0 };

  const current = new Set<string>();
  for (const tool of tools) {
    current.add(tool.name);
    const wrote = writeIfChanged(join(providerDir, `${fileBase(tool.name)}.ts`), renderToolFile(spec.provider, tool));
    if (!prevTools.has(tool.name)) diff.added.push(tool.name);
    else if (wrote) diff.changed.push(tool.name);
    else diff.unchanged++;
  }
  for (const old of prevTools) {
    if (!current.has(old) && removeIfExists(join(providerDir, `${fileBase(old)}.ts`))) diff.removed.push(old);
  }

  writeIfChanged(join(providerDir, "index.ts"), renderBarrel(tools));
  writeSecretKeys(workspaceDir, spec);
  manifest.providers[spec.provider] = providerEntry(spec, tools, prev);
  manifest.generator = GENERATOR_VERSION;
  writeManifest(workspaceDir, manifest);
  writeEmittedClient(workspaceDir);
  writePublicDocs(workspaceDir, manifest);

  diff.added.sort();
  diff.changed.sort();
  diff.removed.sort();
  return diff;
}
