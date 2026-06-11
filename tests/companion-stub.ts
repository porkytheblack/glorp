/**
 * Reference implementation of the companion-service wire contract
 * (docs/companion-service-spec.md). The real service should be drop-in
 * indistinguishable from this stub as far as Garage's client is concerned:
 * bearer auth, `GET /v1/git/token?repo=`, `GET /v1/templates` (ETag + 304),
 * `GET /v1/templates/{name}`, and the standard `{error, message}` body on
 * every non-200.
 */

import { createHash } from "node:crypto";

export interface CompanionStub {
  url: string;
  /** Mutate then bump etag via `setTemplates`. */
  setTemplates(templates: unknown[]): void;
  mintCount: number;
  listCount: number;
  /** Last `repo` query value the token endpoint received (decoded). */
  lastRepo: string | null;
  /** Flip to simulate an outage (every endpoint 500s). */
  down: boolean;
  close(): void;
}

export function startCompanionStub(key = "test-key"): CompanionStub {
  let templates: unknown[] = [];
  let etag = '"empty"';
  const stub = {
    mintCount: 0,
    listCount: 0,
    lastRepo: null as string | null,
    down: false,
  };

  const err = (slug: string, message: string, status: number) =>
    Response.json({ error: slug, message }, { status });

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      if (stub.down) return err("unavailable", "simulated outage", 500);
      const u = new URL(req.url);
      if (req.headers.get("authorization") !== `Bearer ${key}`) {
        return err("unauthorized", "Missing or invalid service key", 401);
      }

      if (u.pathname === "/v1/git/token") {
        stub.mintCount++;
        stub.lastRepo = u.searchParams.get("repo");
        return Response.json({
          token: `ghs_stub_${stub.lastRepo || "org"}`,
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        });
      }

      if (u.pathname === "/v1/templates") {
        stub.listCount++;
        if (req.headers.get("if-none-match") === etag) {
          return new Response(null, { status: 304, headers: { etag } });
        }
        return Response.json({ templates }, { headers: { etag } });
      }

      const one = u.pathname.match(/^\/v1\/templates\/([^/]+)$/);
      if (one) {
        const name = decodeURIComponent(one[1]!);
        const t = templates.find((x) => (x as { name?: string }).name === name);
        return t ? Response.json({ template: t }) : err("not_found", `No template: ${name}`, 404);
      }

      return err("not_found", `No route: ${u.pathname}`, 404);
    },
  });

  return {
    ...stub,
    url: `http://127.0.0.1:${server.port}`,
    setTemplates(next: unknown[]): void {
      templates = next;
      etag = `"${createHash("sha1").update(JSON.stringify(next)).digest("hex").slice(0, 12)}"`;
    },
    get mintCount() {
      return stub.mintCount;
    },
    get listCount() {
      return stub.listCount;
    },
    get lastRepo() {
      return stub.lastRepo;
    },
    get down() {
      return stub.down;
    },
    set down(v: boolean) {
      stub.down = v;
    },
    close() {
      server.stop(true);
    },
  };
}
