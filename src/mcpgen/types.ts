/** Shared types for the MCP-workspace provisioning engine. */

/** A single MCP tool as reported by `tools/list`. */
export interface ToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** One named identity (e.g. a Linear workspace) and its bearer token. */
export interface IdentitySpec {
  name: string;
  token: string;
  label?: string;
}

/** Everything needed to install or refresh one MCP provider. */
export interface ProviderSpec {
  /** Namespace + folder name, e.g. "linear". */
  provider: string;
  /** MCP server URL (Streamable HTTP). */
  url: string;
  identities: IdentitySpec[];
  /** Identity used when a call doesn't pick one; falls back to the first. */
  defaultIdentity?: string;
}

/** Non-secret per-provider record persisted in mcp/manifest.json. */
export interface ProviderManifest {
  url: string;
  defaultIdentity?: string;
  /** Public identity metadata — names + labels only, never tokens. */
  identities: Array<{ name: string; label?: string }>;
  tools: string[];
  toolsHash: string;
  installedAt: string;
  syncedAt: string;
  generator: string;
}

export interface Manifest {
  version: 1;
  generator: string;
  providers: Record<string, ProviderManifest>;
}

/** Result of an add/sync against one provider. */
export interface SyncDiff {
  provider: string;
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: number;
  /** Set when sync failed for this provider (sync-all is fail-soft). */
  error?: string;
}

/** Bumped when the codegen templates change, to force regeneration. */
export const GENERATOR_VERSION = "1.0.0";
