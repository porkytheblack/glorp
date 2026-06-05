import { inputInterface } from "./schema-ts.ts";
import type { ToolDef } from "./types.ts";

/** snake/kebab/space → PascalCase, for type names. */
export function pascal(s: string): string {
  return s.replace(/(^|[_\-\s]+)([a-zA-Z0-9])/g, (_m, _sep, c: string) => c.toUpperCase());
}

/** Safe file/identifier base for a tool name (path- and ident-friendly). */
export function fileBase(name: string): string {
  return name.replace(/[^A-Za-z0-9_$]/g, "_");
}

/** A valid TS identifier — sanitised and never starting with a digit. */
function identSafe(name: string): string {
  const base = fileBase(name);
  return /^[0-9]/.test(base) ? `_${base}` : base;
}

function exportName(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : identSafe(name);
}

/** Collapse whitespace and neutralise comment terminators from external text. */
function commentSafe(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\*\//g, "* /").trim();
}

/** Render the wrapper module for a single MCP tool. */
export function renderToolFile(provider: string, tool: ToolDef): string {
  const iface = `${identSafe(pascal(tool.name))}Input`;
  const fn = exportName(tool.name);
  const doc = tool.description ? `\n * ${commentSafe(tool.description)}` : "";
  return [
    `// Generated from MCP tool "${commentSafe(tool.name)}". Do not edit — regenerated on MCP sync.`,
    `import { callTool } from "../_runtime/client.ts";`,
    ``,
    inputInterface(iface, tool.inputSchema),
    ``,
    `/**${doc}`,
    ` * Provider: ${provider} · MCP tool: ${tool.name}`,
    ` */`,
    `export function ${fn}(input: ${iface}, opts?: { identity?: string }): Promise<unknown> {`,
    `  return callTool(`,
    `    { provider: ${JSON.stringify(provider)}, tool: ${JSON.stringify(tool.name)}, identity: opts?.identity },`,
    `    input,`,
    `  );`,
    `}`,
    ``,
  ].join("\n");
}

/** Render the per-provider barrel that re-exports every tool. */
export function renderBarrel(tools: ToolDef[]): string {
  const lines = tools.map((t) => `export * from "./${fileBase(t.name)}.ts";`).sort();
  return ["// Generated barrel. Do not edit.", ...lines, ""].join("\n");
}
