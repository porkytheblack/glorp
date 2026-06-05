/**
 * Self-authenticating MCP runtime client for a provisioned workspace.
 *
 * Dependency-free: uses only node: builtins + fetch, so the workspace needs
 * no install step. The per-identity bearer token is read from the secret
 * keyfile *at call time* — it never enters process.env, and only the tool
 * result is returned to the caller. Generated file: do not edit by hand — it
 * is regenerated on MCP sync.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HERE = import.meta.dir;
const KEYFILE = process.env.MCP_KEYS_FILE ?? resolve(HERE, "../../.secrets/keys.json");
const MANIFEST = resolve(HERE, "../manifest.json");
const PROTOCOL_VERSION = "2025-06-18";

export interface CallSelector {
  provider: string;
  tool: string;
  identity?: string;
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Pick the identity (explicit → env → configured default → first) + its token. */
export function resolveIdentity(provider: string, explicit?: string): { name: string; token: string } {
  const cfg = readJson(KEYFILE)[provider];
  if (!cfg?.identities) throw new Error(`No keys for provider "${provider}"`);
  const names = Object.keys(cfg.identities);
  if (names.length === 0) throw new Error(`No identities for provider "${provider}"`);
  const name = explicit ?? process.env[`MCP_IDENTITY_${provider}`] ?? cfg.default ?? names[0];
  const entry = cfg.identities[name];
  if (!entry) throw new Error(`Unknown identity "${name}" for "${provider}". Have: ${names.join(", ")}`);
  return { name, token: entry.token };
}

function serverUrl(provider: string): string {
  const url = readJson(MANIFEST)?.providers?.[provider]?.url;
  if (!url) throw new Error(`No URL for provider "${provider}" in manifest`);
  return url;
}

function mcpHeaders(token: string, sessionId: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
    "mcp-protocol-version": PROTOCOL_VERSION,
  };
  if (sessionId) h["mcp-session-id"] = sessionId;
  return h;
}

/** Extract a JSON-RPC response from a JSON or SSE (text/event-stream) body. */
async function parseRpc(res: Response): Promise<any> {
  const text = await res.text();
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!data) continue;
      const msg = JSON.parse(data);
      if (msg && (msg.result !== undefined || msg.error !== undefined)) return msg;
    }
    throw new Error("no JSON-RPC response in SSE stream");
  }
  return text ? JSON.parse(text) : {};
}

let rpcId = 1;

async function post(url: string, token: string, sessionId: string | null, method: string, params?: unknown) {
  const isNotification = method.startsWith("notifications/");
  const body: any = { jsonrpc: "2.0", method };
  if (!isNotification) body.id = rpcId++;
  if (params !== undefined) body.params = params;
  const res = await fetch(url, { method: "POST", headers: mcpHeaders(token, sessionId), body: JSON.stringify(body) });
  if (!res.ok && res.status !== 202) throw new Error(`MCP ${method}: HTTP ${res.status} ${res.statusText}`);
  return { res, json: isNotification || res.status === 202 ? {} : await parseRpc(res) };
}

// One initialized session per (url + identity) for the life of the process.
const sessions = new Map<string, Promise<string | null>>();

async function initSession(url: string, token: string): Promise<string | null> {
  const { res, json } = await post(url, token, null, "initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "glorp-mcp-workspace", version: "1" },
  });
  if (json?.error) throw new Error(`MCP initialize: ${json.error.message ?? "error"}`);
  const sid = res.headers.get("mcp-session-id");
  await post(url, token, sid, "notifications/initialized").catch((err) => {
    console.error(`[mcp] notifications/initialized failed for ${url}:`, err);
  });
  return sid;
}

/** Call an MCP tool with the selected identity; returns the tool's result. */
export async function callTool(sel: CallSelector, input: unknown): Promise<any> {
  const { name, token } = resolveIdentity(sel.provider, sel.identity);
  const url = serverUrl(sel.provider);
  const key = `${url}::${name}`;
  let pending = sessions.get(key);
  if (!pending) {
    // Don't cache a failed handshake — drop it so the next call retries.
    pending = initSession(url, token).catch((err) => {
      sessions.delete(key);
      throw err;
    });
    sessions.set(key, pending);
  }
  const sessionId = await pending;
  const { json } = await post(url, token, sessionId, "tools/call", { name: sel.tool, arguments: input ?? {} });
  if (json?.error) throw new Error(`${sel.provider}.${sel.tool}: ${json.error.message ?? "error"}`);
  return json.result;
}
