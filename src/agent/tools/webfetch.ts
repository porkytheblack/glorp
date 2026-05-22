import { z } from "zod";
import * as dns from "node:dns/promises";
import * as net from "node:net";
import type { GloveFoldArgs } from "glove-core";

const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 5;
const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classifies an IP literal as private/loopback/link-local/etc. so we
 * never let `web_fetch` reach cloud-metadata endpoints (169.254.169.254),
 * Redis on localhost, the Kubernetes API on 10.x, and similar.
 */
function isPrivateIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number, number, number];
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10/8
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + AWS/Azure IMDS
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 0) return true; // 192.0.0/24
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    // IPv4-mapped: ::ffff:a.b.c.d — fall back to v4 check on the tail.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]!);
    // fc00::/7 (unique local), fe80::/10 (link-local), ff00::/8 (multicast).
    const first = parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true;
    if ((first & 0xffc0) === 0xfe80) return true;
    if ((first & 0xff00) === 0xff00) return true;
    return false;
  }
  return false;
}

/**
 * Verifies the URL is one we're willing to fetch:
 *   - scheme is http(s)
 *   - port is in the conservative allowlist
 *   - host resolves to a public address (or is a literal public IP)
 *
 * Set GLORP_ALLOW_PRIVATE_FETCH=1 to bypass — for tests against a local
 * server, or for the (rare) deliberate intranet fetch.
 */
async function validateUrl(raw: string): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `scheme ${url.protocol} not allowed (http/https only)` };
  }
  if (process.env.GLORP_ALLOW_PRIVATE_FETCH === "1") {
    return { ok: true, url };
  }
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!ALLOWED_PORTS.has(port)) {
    return { ok: false, reason: `port ${port} not allowed` };
  }
  // Strip the IPv6 brackets that WHATWG URL preserves on `hostname`.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isPrivateIp(host)) {
      return { ok: false, reason: `host ${host} is a private/loopback address` };
    }
    return { ok: true, url };
  }
  // DNS-rebinding defence: resolve here and reject if ANY answer is
  // private. fetch() will resolve again, but agreement on the first
  // public hit is enough to stop the obvious rebind oracles. For a
  // hardened deployment, follow up with a custom dispatcher that pins
  // the address chosen here.
  try {
    const addrs = await dns.lookup(host, { all: true, verbatim: true });
    if (addrs.length === 0) return { ok: false, reason: `host ${host} did not resolve` };
    for (const a of addrs) {
      if (isPrivateIp(a.address)) {
        return { ok: false, reason: `host ${host} resolves to private address ${a.address}` };
      }
    }
  } catch (err: any) {
    return { ok: false, reason: `dns lookup failed: ${err?.message ?? err}` };
  }
  return { ok: true, url };
}

/**
 * fetch() with manual redirect handling so we re-run validateUrl on every
 * hop. Without this, an attacker-controlled public URL can 302 us to
 * http://169.254.169.254/... and the SSRF check on the initial URL is
 * meaningless.
 */
async function fetchWithRedirects(
  startUrl: URL,
  signal: AbortSignal | undefined,
): Promise<Response> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current.toString(), {
      signal,
      redirect: "manual",
      headers: { "User-Agent": "Glorp/0.1 (alien coding agent)" },
    });
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get("location");
    if (!loc) return res;
    const nextUrl = new URL(loc, current);
    const v = await validateUrl(nextUrl.toString());
    if (!v.ok) {
      throw new Error(`refusing redirect to ${nextUrl.toString()}: ${v.reason}`);
    }
    current = v.url;
  }
  throw new Error(`too many redirects (>${MAX_REDIRECTS})`);
}

/**
 * Streams the response body, slicing as bytes arrive and aborting once
 * MAX_BYTES is exceeded. Prevents a hostile server with a huge or
 * unbounded body from buffering a multi-gigabyte blob in memory.
 */
async function readCapped(res: Response): Promise<{ bytes: Uint8Array; truncated: boolean; totalBytes: number }> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    const truncated = buf.byteLength > MAX_BYTES;
    return { bytes: truncated ? buf.slice(0, MAX_BYTES) : buf, truncated, totalBytes: buf.byteLength };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = MAX_BYTES - total;
      if (value.byteLength > remaining) {
        chunks.push(value.slice(0, remaining));
        total += remaining;
        try { await reader.cancel(); } catch {}
        return { bytes: concat(chunks, total), truncated: true, totalBytes: total };
      }
      chunks.push(value);
      total += value.byteLength;
    }
    // Drain to learn whether more bytes existed (so we can flag truncated).
    let truncated = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        truncated = true;
        try { await reader.cancel(); } catch {}
        break;
      }
    }
    return { bytes: concat(chunks, total), truncated, totalBytes: total };
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

export const webFetchTool: GloveFoldArgs<{
  url: string;
  mode?: "text" | "raw";
}> = {
  name: "web_fetch",
  description:
    "Fetch a URL and return text. By default strips HTML tags and collapses whitespace. " +
    "Set mode: 'raw' to get the raw body. Useful for pulling docs, READMEs, RFCs. " +
    "Restricted to public http(s) endpoints — private/loopback/metadata addresses are refused.",
  inputSchema: z.object({
    url: z.string().url().describe("Full URL (http or https)"),
    mode: z.enum(["text", "raw"]).optional().describe("text (strip HTML) or raw (verbatim)"),
  }),
  async do(input, _display, _glove, signal) {
    const validated = await validateUrl(input.url);
    if (!validated.ok) {
      return { status: "error", data: null, message: `fetch refused: ${validated.reason}` };
    }
    try {
      const res = await fetchWithRedirects(validated.url, signal);
      if (!res.ok) {
        return {
          status: "error",
          data: null,
          message: `HTTP ${res.status} ${res.statusText}`,
        };
      }
      const { bytes, truncated, totalBytes } = await readCapped(res);
      const body = new TextDecoder().decode(bytes);
      const out = (input.mode ?? "text") === "raw" ? body : stripTags(body);
      return {
        status: "success",
        data: out + (truncated ? `\n... [truncated at ${MAX_BYTES} bytes]` : ""),
        renderData: {
          url: validated.url.toString(),
          contentType: res.headers.get("content-type"),
          bytes: totalBytes,
          truncated,
        },
      };
    } catch (err: any) {
      return { status: "error", data: null, message: `fetch failed: ${err.message}` };
    }
  },
};
