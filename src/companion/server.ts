/**
 * The reference companion service — a working implementation of
 * docs/companion-service-spec.md, suitable as-is for the all-in-one container
 * (where Garage talks to it over loopback) and as the starting point for a
 * hosted deployment. Two capabilities: GitHub App installation-token minting
 * (§2; requires GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY) and the template
 * registry (§3; serves --templates-dir with skills resolved server-side).
 *
 * Auth mirrors Garage's model: loopback binds run open unless COMPANION_KEY
 * is set; non-loopback binds REQUIRE it.
 */

import { GitHubAppMinter, GitHubTokenError, type GitHubAppConfig } from "./github-tokens.ts";
import { loadResolvedTemplates } from "./templates.ts";

export interface CompanionConfig {
  hostname: string;
  port: number;
  templatesDir: string;
  /** Bearer key required of callers; mandatory on non-loopback binds. */
  key?: string;
  github?: GitHubAppConfig;
}

export interface CompanionHandle {
  port: number;
  stop(): void;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function startCompanion(config: CompanionConfig): CompanionHandle {
  if (!config.key && !LOOPBACK.has(config.hostname)) {
    throw new Error("companion: binding a non-loopback host requires COMPANION_KEY");
  }
  const minter = config.github ? new GitHubAppMinter(config.github) : null;

  const err = (slug: string, message: string, status: number) =>
    Response.json({ error: slug, message }, { status });

  const server = Bun.serve({
    hostname: config.hostname,
    port: config.port,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url);
      if (url.pathname === "/health") return Response.json({ ok: true });
      if (config.key && req.headers.get("authorization") !== `Bearer ${config.key}`) {
        return err("unauthorized", "Missing or invalid service key", 401);
      }
      if (req.method !== "GET") return err("method_not_allowed", "Method not allowed", 405);

      if (url.pathname === "/v1/git/token") {
        if (!minter) {
          return err("not_configured", "Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY to mint git tokens", 404);
        }
        try {
          // A bearer credential over GET — forbid every cache along the way.
          return Response.json(await minter.tokenFor(url.searchParams.get("repo") || null), {
            headers: { "cache-control": "no-store" },
          });
        } catch (e) {
          if (e instanceof GitHubTokenError) return err(e.slug, e.message, e.status);
          return err("github_error", "Token minting failed", 502);
        }
      }

      if (url.pathname === "/v1/templates") {
        const { templates, etag } = loadResolvedTemplates(config.templatesDir);
        if (req.headers.get("if-none-match") === etag) {
          return new Response(null, { status: 304, headers: { etag } });
        }
        return Response.json({ templates }, { headers: { etag } });
      }

      const one = url.pathname.match(/^\/v1\/templates\/([^/]+)$/);
      if (one) {
        const name = decodeURIComponent(one[1]!);
        const t = loadResolvedTemplates(config.templatesDir).templates.find((x) => x.name === name);
        return t ? Response.json({ template: t }) : err("not_found", `No template: ${name}`, 404);
      }

      return err("not_found", `No route: ${url.pathname}`, 404);
    },
  });

  return { port: server.port ?? config.port, stop: () => server.stop(true) };
}
