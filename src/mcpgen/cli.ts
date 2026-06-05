#!/usr/bin/env bun
/**
 * Minimal CLI for the MCP-workspace engine — a stand-in for the eventual
 * Station provisioning endpoint. Drives add / sync / sync-all against a
 * real MCP URL and prints the resulting diff as JSON.
 *
 *   bun run src/mcpgen/cli.ts add --workspace ./ws --provider linear \
 *     --url https://mcp.linear.com --identity acme:lin_xxx:Acme --default acme
 *   bun run src/mcpgen/cli.ts sync --workspace ./ws --provider linear
 *   bun run src/mcpgen/cli.ts sync-all --workspace ./ws
 */
import { addProvider, syncAll, syncProvider } from "./workspace.ts";
import type { IdentitySpec, ProviderSpec } from "./types.ts";

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

/** A flag's value, or undefined when missing, empty, or itself another `--flag`. */
function valueAt(args: string[], i: number): string | undefined {
  const v = args[i];
  return v && !v.startsWith("--") ? v : undefined;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? valueAt(args, i + 1) : undefined;
}

function flags(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}`) {
      const v = valueAt(args, i + 1);
      if (v) out.push(v);
    }
  }
  return out;
}

/** `name:token[:label]` → IdentitySpec. */
function parseIdentity(raw: string): IdentitySpec {
  const [name, token, label] = raw.split(":");
  if (!name || !token) fail(`bad --identity "${raw}" (expected name:token[:label])`);
  return { name, token, label };
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const ws = flag(rest, "workspace") ?? process.cwd();

  if (cmd === "add") {
    const spec: ProviderSpec = {
      provider: flag(rest, "provider") ?? fail("missing --provider"),
      url: flag(rest, "url") ?? fail("missing --url"),
      identities: flags(rest, "identity").map(parseIdentity),
      defaultIdentity: flag(rest, "default"),
    };
    print(await addProvider(ws, spec));
  } else if (cmd === "sync") {
    print(await syncProvider(ws, flag(rest, "provider") ?? fail("missing --provider")));
  } else if (cmd === "sync-all") {
    print(await syncAll(ws));
  } else {
    fail(`unknown command "${cmd ?? ""}" (expected: add | sync | sync-all)`);
  }
}

function print(result: unknown): void {
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
