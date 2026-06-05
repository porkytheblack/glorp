import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeIfChanged } from "./fsutil.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Copy the self-authenticating runtime client into the workspace at
 * mcp/_runtime/client.ts. Read from source when running from a checkout; a
 * compiled binary would embed it (same pattern as scripts/embed-prompts.ts).
 */
export function writeEmittedClient(workspaceDir: string): void {
  const src = readFileSync(join(HERE, "emitted", "client.ts"), "utf8");
  writeIfChanged(join(workspaceDir, "mcp", "_runtime", "client.ts"), src);
}
