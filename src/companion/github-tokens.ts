/**
 * GitHub App installation-token minting — the server half of
 * docs/companion-service-spec.md §2.4. The app's PRIVATE KEY lives here and
 * only here: a short-lived RS256 app JWT (cached ~9 min) resolves the
 * installation that grants access to the requested repo, then mints an
 * installation token scoped DOWN to that one repository. Tokens are cached
 * until shortly before GitHub's expiry so helper-driven bursts don't hammer
 * the API. `apiUrl` is injectable for tests and GitHub Enterprise.
 */

import { createSign } from "node:crypto";

export interface GitHubAppConfig {
  appId: string;
  /** PEM, or base64-of-PEM (convenient for env vars). */
  privateKey: string;
  apiUrl?: string;
}

export interface MintedToken {
  token: string;
  expires_at: string;
}

export class GitHubTokenError extends Error {
  constructor(
    public readonly status: number,
    public readonly slug: string,
    message: string,
  ) {
    super(message);
  }
}

const JWT_TTL_S = 9 * 60;
const TOKEN_MARGIN_MS = 5 * 60_000;

const b64url = (input: string | Buffer): string =>
  Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export class GitHubAppMinter {
  private readonly pem: string;
  private readonly api: string;
  private jwt: { value: string; freshUntil: number } | null = null;
  private readonly installations = new Map<string, number>(); // owner/repo (or "") → id
  private readonly tokens = new Map<string, { minted: MintedToken; freshUntil: number }>();

  constructor(private readonly config: GitHubAppConfig) {
    this.pem = config.privateKey.includes("BEGIN")
      ? config.privateKey
      : Buffer.from(config.privateKey, "base64").toString("utf-8");
    this.api = (config.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
  }

  /** Mint (or serve cached) an installation token for `repo` ("owner/name", optional). */
  async tokenFor(repo: string | null): Promise<MintedToken> {
    const key = repo ?? "";
    const cached = this.tokens.get(key);
    if (cached && cached.freshUntil > Date.now()) return cached.minted;

    const installationId = await this.resolveInstallation(repo);
    const body = repo ? { repositories: [repo.split("/")[1]!] } : {};
    const res = await this.gh(`/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new GitHubTokenError(502, "github_error", `GitHub token mint failed (${res.status})`);
    }
    const minted = (await res.json()) as MintedToken;
    this.tokens.set(key, {
      minted,
      freshUntil: Date.parse(minted.expires_at) - TOKEN_MARGIN_MS,
    });
    return minted;
  }

  private async resolveInstallation(repo: string | null): Promise<number> {
    const key = repo ?? "";
    const known = this.installations.get(key);
    if (known !== undefined) return known;

    let id: number | undefined;
    if (repo) {
      const res = await this.gh(`/repos/${repo}/installation`);
      if (res.status === 404) {
        throw new GitHubTokenError(404, "not_installed", `The GitHub App is not installed on ${repo}`);
      }
      if (!res.ok) throw new GitHubTokenError(502, "github_error", `GitHub installation lookup failed (${res.status})`);
      id = ((await res.json()) as { id: number }).id;
    } else {
      const res = await this.gh(`/app/installations?per_page=1`);
      if (!res.ok) throw new GitHubTokenError(502, "github_error", `GitHub installations list failed (${res.status})`);
      id = ((await res.json()) as Array<{ id: number }>)[0]?.id;
      if (id === undefined) throw new GitHubTokenError(404, "not_installed", "The GitHub App has no installations");
    }
    this.installations.set(key, id);
    return id;
  }

  private gh(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${this.api}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.appJwt()}`,
        accept: "application/vnd.github+json",
        "user-agent": "glorp-companion",
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
  }

  /** RS256 app JWT, cached until ~1 min before its 10-minute expiry. */
  private appJwt(): string {
    if (this.jwt && this.jwt.freshUntil > Date.now()) return this.jwt.value;
    const now = Math.floor(Date.now() / 1000);
    // iat backdated 60s per GitHub's clock-drift guidance.
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + JWT_TTL_S, iss: this.config.appId }));
    const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(this.pem);
    const value = `${header}.${payload}.${b64url(signature)}`;
    this.jwt = { value, freshUntil: (now + JWT_TTL_S - 60) * 1000 };
    return value;
  }
}
