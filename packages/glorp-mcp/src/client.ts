/**
 * Resolve the Glorp client the MCP tools drive, from the environment:
 *   GLORP_ENDPOINT   (required)  — Station base URL, e.g. https://glorp.example.com
 *   GLORP_API_KEY    (optional)  — admin key for orchestration, or a tenant key
 *   GLORP_NAMESPACE  (optional)  — pin every call to this namespace (admin proxy)
 *
 * `clientFor(ns)` returns a client bound to a namespace when a tool passes one
 * (admin keys use this to act inside a tenant); otherwise the base client.
 */

import { createClient, type GlorpClient } from "@porkytheblack/glorp-client";

export interface McpContext {
  base: GlorpClient;
  clientFor(namespace?: string): GlorpClient;
}

export function buildContext(): McpContext {
  const endpoint = process.env.GLORP_ENDPOINT;
  if (!endpoint) {
    throw new Error("GLORP_ENDPOINT is required (the Station base URL, e.g. https://glorp.example.com).");
  }
  const base = createClient({
    endpoint,
    apiKey: process.env.GLORP_API_KEY,
    namespace: process.env.GLORP_NAMESPACE,
  });
  return {
    base,
    clientFor: (namespace) => (namespace ? base.forNamespace(namespace) : base),
  };
}
