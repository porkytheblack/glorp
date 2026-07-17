import { z } from "zod";
import { compactText } from "./summaries.ts";
import type { SummaryTool } from "./summaries.ts";

const MAX_BYTES = 512 * 1024;
// A 512 KB body is ~128k tokens — enough to flood most context windows on its
// own. Cap the text handed to the model far below the fetch cap.
const MAX_TEXT_CHARS = 100_000;

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
      const clamped = out.length > MAX_TEXT_CHARS;
      const text = clamped ? out.slice(0, MAX_TEXT_CHARS) : out;
      const notes = [
        truncated ? `\n... [fetch truncated at ${MAX_BYTES} bytes]` : "",
        clamped ? `\n... [output clamped at ${MAX_TEXT_CHARS} of ${out.length} chars]` : "",
      ].join("");
      return {
        status: "success",
        data: text + notes,
        generateSummaryArgs: {
          url: input.url,
          mode: input.mode ?? "text",
          contentType: res.headers.get("content-type"),
          bytes: buf.byteLength,
          truncated: truncated || clamped,
          preview: compactText(text, 24, 4000),
        } satisfies WebFetchSummaryArgs,
        renderData: {
          url: input.url,
          contentType: res.headers.get("content-type"),
          bytes: buf.byteLength,
          truncated: truncated || clamped,
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
