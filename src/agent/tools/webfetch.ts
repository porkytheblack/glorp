import { z } from "zod";
import { compactText } from "./summaries.ts";
import type { SummaryTool } from "./summaries.ts";

const MAX_BYTES = 512 * 1024;

interface WebFetchSummaryArgs {
  url: string;
  mode: "text" | "raw";
  contentType: string | null;
  bytes: number;
  truncated: boolean;
  preview: string;
}

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

export const webFetchTool: SummaryTool<{
  url: string;
  mode?: "text" | "raw";
}, WebFetchSummaryArgs> = {
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
        generateSummaryArgs: {
          url: input.url,
          mode: input.mode ?? "text",
          contentType: res.headers.get("content-type"),
          bytes: buf.byteLength,
          truncated,
          preview: compactText(out, 24, 4000),
        } satisfies WebFetchSummaryArgs,
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
  generateToolSummary: async (args) => {
    const a = args as WebFetchSummaryArgs;
    return [
      `Fetched ${a.url} (${a.mode}, ${a.contentType ?? "unknown content-type"}, ${a.bytes} bytes${
        a.truncated ? `, truncated at ${MAX_BYTES} bytes` : ""
      }).`,
      a.preview ? `Preview:\n${a.preview}` : "",
      "Full prior fetch body omitted; fetch again if exact text is needed.",
    ].filter(Boolean).join("\n");
  },
};
