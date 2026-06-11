/**
 * Shared shape-normalization for template documents, whether read from the
 * operator's disk library or fetched from the companion-service registry
 * (docs/companion-service-spec.md §3.3). Returns undefined for documents that
 * provision nothing — callers skip those rather than erroring, so one bad
 * file/entry never takes the whole library down.
 */

import type { Template } from "./types.ts";

export function normalizeTemplate(raw: Partial<Template>, fallbackName?: string): Template | undefined {
  const name = typeof raw.name === "string" && raw.name ? raw.name : fallbackName;
  if (!name) return undefined;
  // A template must provision SOMETHING — any v1 or v2 section qualifies.
  const hasContent =
    Array.isArray(raw.steps) ||
    Array.isArray(raw.repos) ||
    Array.isArray(raw.skills) ||
    Array.isArray(raw.mcp) ||
    typeof raw.system_prompt === "string";
  if (!hasContent) return undefined;
  return {
    name,
    description: raw.description,
    steps: Array.isArray(raw.steps) ? raw.steps : undefined,
    repos: Array.isArray(raw.repos) ? raw.repos : undefined,
    skills: Array.isArray(raw.skills) ? raw.skills : undefined,
    system_prompt: typeof raw.system_prompt === "string" ? raw.system_prompt : undefined,
    mcp: Array.isArray(raw.mcp) ? raw.mcp : undefined,
    params: Array.isArray(raw.params) ? raw.params : undefined,
  };
}
