/**
 * Serves the pre-built Glorp Dashboard SPA (dashboard/ → dist/dashboard) as
 * static files. Unknown GET paths fall back to index.html so client-side
 * routing works. Only reached when `station.json: { "dashboard": true }`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../../dist/dashboard", import.meta.url));

export function dashboardBuilt(): boolean {
  return fs.existsSync(path.join(DIST, "index.html"));
}

export async function serveDashboard(pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(DIST, rel));
  // Block path traversal outside the dist root.
  if (filePath !== DIST && !filePath.startsWith(DIST + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  const file = Bun.file(filePath);
  if (await file.exists()) return new Response(file);

  // SPA fallback — serve index.html for client-routed paths.
  const index = Bun.file(path.join(DIST, "index.html"));
  if (await index.exists()) return new Response(index);
  return new Response("Dashboard is not built. Run `bun run build` in dashboard/.", { status: 404 });
}
