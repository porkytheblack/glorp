/**
 * Serves the pre-built Glorp Dashboard SPA as static files, with SPA fallback.
 * Only reached when `station.json: { "dashboard": true }`.
 *
 * Resolving the assets is the tricky part: Station runs from source, from an
 * npm install, AND from a `bun build --compile` single-file binary. In the
 * compiled binary `import.meta.url` points at an in-binary virtual FS, so we
 * probe several real on-disk locations (the data dir wins — that's where the
 * installer drops the assets) and use the first that has an index.html.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Ordered list of places the built dashboard may live, most specific first. */
export function dashboardSearchPaths(dataDir: string): string[] {
  const dirs: string[] = [];
  if (process.env.GLORP_DASHBOARD_DIR) dirs.push(process.env.GLORP_DASHBOARD_DIR);
  // Installed alongside state — where install.sh copies it for the compiled binary.
  dirs.push(path.join(dataDir, "dashboard"));
  // Running from source or an npm install (src/station/ → ../../dist/dashboard).
  try {
    dirs.push(fileURLToPath(new URL("../../dist/dashboard", import.meta.url)));
  } catch {
    /* import.meta.url not a file URL (some bundlers) — skip */
  }
  // Next to the executable (e.g. running ./dist/glorp from the repo).
  const exeDir = path.dirname(process.execPath);
  dirs.push(path.join(exeDir, "glorp-dashboard"));
  dirs.push(path.join(exeDir, "dist", "dashboard"));
  dirs.push(path.join(process.cwd(), "dist", "dashboard"));
  return dirs;
}

/** The first search path that actually contains a built index.html, or null. */
export function resolveDashboardDir(dataDir: string): string | null {
  for (const dir of dashboardSearchPaths(dataDir)) {
    try {
      if (fs.existsSync(path.join(dir, "index.html"))) return dir;
    } catch {
      /* unreadable candidate — keep looking */
    }
  }
  return null;
}

export function dashboardBuilt(dataDir: string): boolean {
  return resolveDashboardDir(dataDir) !== null;
}

export async function serveDashboard(dataDir: string, pathname: string): Promise<Response> {
  const dist = resolveDashboardDir(dataDir);
  if (!dist) {
    return new Response("Dashboard assets not found. Run `bun run build:dashboard`.", { status: 404 });
  }
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(dist, rel));
  // Block path traversal outside the dist root.
  if (filePath !== dist && !filePath.startsWith(dist + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  const file = Bun.file(filePath);
  if (await file.exists()) return new Response(file);
  // SPA fallback — serve index.html for client-routed paths.
  const index = Bun.file(path.join(dist, "index.html"));
  if (await index.exists()) return new Response(index);
  return new Response("Dashboard index.html missing", { status: 404 });
}
