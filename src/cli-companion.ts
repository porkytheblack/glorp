/**
 * `glorp companion` — run the reference companion service (git token minting
 * + template registry; docs/companion-service-spec.md). Config via env:
 *   GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY[_FILE]  app credentials (PEM or base64)
 *   COMPANION_KEY                                  bearer key (required off-loopback)
 *   GITHUB_API_URL                                 override for tests / GHE
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { startCompanion } from "./companion/server.ts";
import type { CliArgs } from "./cli-args.ts";

export const COMPANION_DEFAULT_PORT = 8788;

export async function runCompanion(args: CliArgs): Promise<void> {
  const dataDir = args.dataDir ?? process.env.GLORP_DATA_DIR ?? path.join(os.homedir(), ".glorp");
  const templatesDir = args.templatesDir ?? path.join(dataDir, "companion-templates");
  fs.mkdirSync(templatesDir, { recursive: true });

  // `||` not `??`: compose passes unset vars as EMPTY strings, which must not
  // mask a configured _FILE fallback.
  const privateKey =
    process.env.GITHUB_APP_PRIVATE_KEY ||
    (process.env.GITHUB_APP_PRIVATE_KEY_FILE
      ? fs.readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_FILE, "utf-8")
      : undefined);
  const appId = process.env.GITHUB_APP_ID || undefined;

  const handle = startCompanion({
    hostname: args.host ?? "127.0.0.1",
    port: args.port ?? COMPANION_DEFAULT_PORT,
    templatesDir,
    key: process.env.COMPANION_KEY || undefined,
    github: appId && privateKey ? { appId, privateKey, apiUrl: process.env.GITHUB_API_URL } : undefined,
  });

  console.log(`[glorp-companion] listening on ${args.host ?? "127.0.0.1"}:${handle.port}`);
  console.log(`[glorp-companion]   templates: ${templatesDir}`);
  console.log(
    appId && privateKey
      ? `[glorp-companion]   git tokens: GitHub App ${appId}`
      : "[glorp-companion]   git tokens: OFF (set GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY)",
  );

  await new Promise<void>((resolve) => {
    process.on("SIGINT", resolve);
    process.on("SIGTERM", resolve);
  });
  handle.stop();
}
