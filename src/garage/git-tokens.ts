/**
 * Pull-model git credentials. An EXTERNAL service owns the GitHub App private
 * key and mints installation tokens; Garage is configured with that service's
 * endpoint and fetches a fresh token whenever git needs one — at template
 * provision time (clone) and afterwards through the `glorp __git-cred`
 * credential helper (fetch/push from live sessions). Tokens are cached until
 * shortly before expiry and never written to disk or `.git/config`.
 *
 * Endpoint contract (deliberately tolerant):
 *   - URL may contain `{repo}` — replaced with the `owner/name` being accessed
 *     (URL-encoded). Without the placeholder the URL is called as-is.
 *   - Headers (e.g. authorization for the token service) come from config.
 *   - Response: JSON `{token | access_token, expires_at?}` or a plain-text
 *     token body. Missing `expires_at` assumes the GitHub-installation default
 *     (1 h) and re-fetches after 50 min.
 */

export interface GitTokenConfig {
  url: string;
  headers?: Record<string, string>;
}

interface CachedToken {
  token: string;
  /** Epoch ms after which the cache entry is stale. */
  freshUntil: number;
}

/** Refresh 5 minutes before the service-reported expiry. */
const EXPIRY_MARGIN_MS = 5 * 60_000;
/** Assumed lifetime when the service reports none (GitHub installation tokens live 1 h). */
const DEFAULT_TTL_MS = 50 * 60_000;

export class GitTokenSource {
  private readonly cache = new Map<string, CachedToken>();

  constructor(private readonly config: GitTokenConfig) {}

  /** Fresh token for `repo` ("owner/name", optional). Null only on a non-OK response. */
  async getToken(repo?: string): Promise<string | null> {
    const url = this.config.url.includes("{repo}")
      ? this.config.url.replace("{repo}", encodeURIComponent(repo ?? ""))
      : this.config.url;
    const cached = this.cache.get(url);
    if (cached && cached.freshUntil > Date.now()) return cached.token;

    const res = await fetch(url, { headers: this.config.headers });
    if (!res.ok) {
      console.warn(`[glorp-garage] git token service responded ${res.status} for ${repo ?? "(no repo)"}`);
      return null;
    }
    const body = await res.text();
    const parsed = parseTokenBody(body);
    if (!parsed.token) return null;
    this.cache.set(url, {
      token: parsed.token,
      freshUntil: parsed.expiresAt ? parsed.expiresAt - EXPIRY_MARGIN_MS : Date.now() + DEFAULT_TTL_MS,
    });
    return parsed.token;
  }
}

function parseTokenBody(body: string): { token: string | null; expiresAt: number | null } {
  const text = body.trim();
  if (!text) return { token: null, expiresAt: null };
  if (text.startsWith("{")) {
    try {
      const j = JSON.parse(text) as { token?: string; access_token?: string; expires_at?: string | number };
      const token = j.token ?? j.access_token ?? null;
      const expiresAt =
        typeof j.expires_at === "number"
          ? j.expires_at * (j.expires_at < 10_000_000_000 ? 1000 : 1) // tolerate seconds or ms
          : typeof j.expires_at === "string"
            ? Date.parse(j.expires_at) || null
            : null;
      return { token, expiresAt };
    } catch {
      return { token: null, expiresAt: null };
    }
  }
  return { token: text, expiresAt: null };
}

/** Build a source from resolved garage config; null when no service is configured. */
export function gitTokenSourceFor(config: { gitTokenUrl?: string; gitTokenHeaders?: Record<string, string> }): GitTokenSource | null {
  return config.gitTokenUrl ? new GitTokenSource({ url: config.gitTokenUrl, headers: config.gitTokenHeaders }) : null;
}

/**
 * The `glorp __git-cred` subcommand — a git credential helper (speaks the
 * `git-credential` stdin/stdout protocol). Installed into cloned repos as
 * `credential.helper`, so fetch/push keeps working after the provision-time
 * token expires, without any token landing in `.git/config`. Resolves its
 * config from env (inherited from the garage process) with a `garage.json`
 * fallback for independently-spawned shells.
 */
export async function runGitCredHelper(action: string | undefined, stdin: string): Promise<number> {
  if (action !== "get") return 0; // store/erase are no-ops — we never persist

  const fields = new Map<string, string>();
  for (const line of stdin.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) fields.set(line.slice(0, eq), line.slice(eq + 1).trim());
  }
  if ((fields.get("protocol") ?? "https") !== "https") return 0;

  const cfg = credHelperConfig();
  if (!cfg) return 0; // unconfigured — stay silent so git falls through to other helpers

  const repo = (fields.get("path") ?? "").replace(/\.git$/, "");
  const token = await new GitTokenSource(cfg).getToken(repo || undefined).catch(() => null);
  if (!token) return 0;

  process.stdout.write(`username=x-access-token\npassword=${token}\n`);
  return 0;
}

function credHelperConfig(): GitTokenConfig | null {
  const envUrl = process.env.GLORP_GARAGE_GIT_TOKEN_URL;
  if (envUrl) return { url: envUrl, headers: parseHeaderEnv(process.env.GLORP_GARAGE_GIT_TOKEN_HEADERS) };
  try {
    // Fallback for shells not spawned by garage: read the same garage.json.
    const os = require("node:os") as typeof import("node:os");
    const path = require("node:path") as typeof import("node:path");
    const fs = require("node:fs") as typeof import("node:fs");
    const dataDir = process.env.GLORP_DATA_DIR ?? path.join(os.homedir(), ".glorp");
    const file = JSON.parse(fs.readFileSync(path.join(dataDir, "garage.json"), "utf-8")) as {
      gitTokenUrl?: string;
      gitTokenHeaders?: Record<string, string>;
    };
    return file.gitTokenUrl ? { url: file.gitTokenUrl, headers: file.gitTokenHeaders } : null;
  } catch {
    return null;
  }
}

/** `GLORP_GARAGE_GIT_TOKEN_HEADERS` is a JSON object of header name → value. */
export function parseHeaderEnv(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const j = JSON.parse(raw) as Record<string, string>;
    return typeof j === "object" && j !== null ? j : undefined;
  } catch {
    return undefined;
  }
}
