import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";

const MAX_BYTES = 512 * 1024;

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

export const webFetchTool: GloveFoldArgs<{
  url: string;
  mode?: "text" | "raw";
}> = {
  name: "web_fetch",
  description:
    "Fetch a URL and return text. By default strips HTML tags and collapses whitespace. " +
    "Set mode: 'raw' to get the raw body. Useful for pulling docs, READMEs, RFCs.",
  inputSchema: z.object({
    url: z.string().url().describe("Full URL (http or https)"),
    mode: z.enum(["text", "raw"]).optional().describe("text (strip HTML) or raw (verbatim)"),
  }),
  async do(input, _display, _glove, signal) {
    try {
      const res = await fetch(input.url, {
        signal,
        headers: { "User-Agent": "Glorp/0.1 (alien coding agent)" },
      });
      if (!res.ok) {
        return {
          status: "error",
          data: null,
          message: `HTTP ${res.status} ${res.statusText}`,
        };
      }
      const buf = await res.arrayBuffer();
      const truncated = buf.byteLength > MAX_BYTES;
      const body = new TextDecoder().decode(
        truncated ? buf.slice(0, MAX_BYTES) : buf,
      );
      const out = (input.mode ?? "text") === "raw" ? body : stripTags(body);
      return {
        status: "success",
        data: out + (truncated ? `\n... [truncated at ${MAX_BYTES} bytes]` : ""),
        renderData: {
          url: input.url,
          contentType: res.headers.get("content-type"),
          bytes: buf.byteLength,
          truncated,
        },
      };
    } catch (err: any) {
      return { status: "error", data: null, message: `fetch failed: ${err.message}` };
    }
  },
};
