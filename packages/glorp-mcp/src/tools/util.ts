/** Shared tool-result helpers: JSON text content + typed-error handling. */

import { GlorpRemoteError } from "@porkytheblack/glorp-client";

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/** Wrap a value as MCP text content (JSON for objects). */
export function ok(data: unknown): ToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

/** Run a client call, returning its JSON or a clean `isError` result on failure. */
export async function guard(fn: () => Promise<unknown> | unknown): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    const msg =
      err instanceof GlorpRemoteError
        ? `${err.status} ${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
  }
}
