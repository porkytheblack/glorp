import { join } from "node:path";
import { writeIfChanged } from "./fsutil.ts";
import type { Manifest } from "./types.ts";

/** Public identity metadata (names + labels + default) — never tokens. */
function publicIdentities(manifest: Manifest) {
  const out: Record<string, { default?: string; identities: Array<{ name: string; label?: string }> }> = {};
  for (const [provider, m] of Object.entries(manifest.providers)) {
    out[provider] = { default: m.defaultIdentity ?? m.identities[0]?.name, identities: m.identities };
  }
  return out;
}

/** Write all agent-facing, token-free files derived from the manifest. */
export function writePublicDocs(workspaceDir: string, manifest: Manifest): void {
  writeIfChanged(
    join(workspaceDir, "mcp", "identities.json"),
    JSON.stringify(publicIdentities(manifest), null, 2) + "\n",
  );
  writeIfChanged(join(workspaceDir, "mcp", "index.md"), renderCatalogue(manifest));
  writeIfChanged(join(workspaceDir, ".claude", "skills", "mcp", "SKILL.md"), SKILL_LINES.join("\n"));
}

function renderCatalogue(manifest: Manifest): string {
  const lines: string[] = ["# MCP tool catalogue", "", "Generated — do not edit.", ""];
  for (const [provider, m] of Object.entries(manifest.providers)) {
    const idList = m.identities.map((i) => (i.label ? i.name + " (" + i.label + ")" : i.name)).join(", ");
    const def = m.defaultIdentity ?? m.identities[0]?.name ?? "—";
    lines.push(
      "## " + provider,
      "",
      "- URL: " + m.url,
      "- Identities: " + (idList || "—") + " · default: " + def,
      "- Tools: " + m.tools.length,
      "",
    );
    for (const t of m.tools) lines.push("  - `" + provider + "/" + t + "`");
    lines.push("");
  }
  return lines.join("\n");
}

const SKILL_LINES = [
  "---",
  "description: Call provisioned MCP provider tools (code execution with MCP)",
  "---",
  "",
  "# MCP provider tools",
  "",
  "External MCP providers are installed in `./mcp/<provider>/` as TypeScript",
  "functions. Each one calls the provider over MCP and returns its result.",
  "",
  "## Using a tool",
  "",
  "Write a short script and run it with bun:",
  "",
  "```ts",
  'import { create_issue } from "./mcp/linear/create_issue.ts";',
  'const res = await create_issue({ title: "Bug", teamId: "TEAM" });',
  "console.log(res);",
  "```",
  "",
  "Discover what's available by listing `./mcp` and reading `./mcp/index.md`.",
  "Read only the tool files you actually need.",
  "",
  "## Identities (e.g. multiple Linear workspaces)",
  "",
  "A provider may expose several identities. Their names, labels and the",
  "default are in `./mcp/identities.json`. Target one by passing `{ identity }`:",
  "",
  "```ts",
  'await create_issue({ title: "Bug", teamId: "TEAM" }, { identity: "acme" });',
  "```",
  "",
  "Omit `identity` to use the provider's default. Auth is automatic — do not",
  "read or print `./.secrets/`; tokens are injected only while a tool runs.",
  "",
];
