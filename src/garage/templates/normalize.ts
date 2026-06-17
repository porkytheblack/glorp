/**
 * Shared shape-normalization for template documents, whether read from the
 * operator's disk library or fetched from the companion-service registry
 * (docs/companion-service-spec.md §3.3). Returns undefined for documents that
 * provision nothing — callers skip those rather than erroring, so one bad
 * file/entry never takes the whole library down.
 */

import type { Template } from "./types.ts";
import type { DeliverableContract } from "../../agent/task-deliverable.ts";

/**
 * Coerce a raw `deliverable` into a well-typed contract, keeping only valid
 * fields and dropping anything malformed (one bad field never disables the
 * whole template). Returns undefined when nothing usable remains.
 */
function normalizeDeliverable(raw: unknown): DeliverableContract | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: DeliverableContract = {};
  if (typeof r.required === "boolean") out.required = r.required;
  if (Array.isArray(r.extensions)) {
    const exts = r.extensions.filter((e): e is string => typeof e === "string" && e.trim() !== "");
    if (exts.length) out.extensions = exts;
  }
  if (typeof r.minCount === "number" && Number.isInteger(r.minCount) && r.minCount >= 0) out.minCount = r.minCount;
  if (r.verify && typeof r.verify === "object") {
    const v = r.verify as Record<string, unknown>;
    if (typeof v.command === "string" && v.command.trim() !== "") {
      out.verify = { command: v.command };
      if (typeof v.timeoutMs === "number" && Number.isInteger(v.timeoutMs) && v.timeoutMs > 0) {
        out.verify.timeoutMs = v.timeoutMs;
      }
    }
  }
  if (typeof r.description === "string" && r.description.trim() !== "") out.description = r.description;
  return Object.keys(out).length > 0 ? out : undefined;
}

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
    deliverable: normalizeDeliverable(raw.deliverable),
  };
}
