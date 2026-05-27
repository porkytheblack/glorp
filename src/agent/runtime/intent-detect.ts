/**
 * Intent-only detection helpers. Shared by model-guards.ts (model-level)
 * and continuation.ts (store-level fallback).
 */

/** Accepts both "agent" (glove-core canonical) and "assistant" (custom adapters). */
export function isAgentSender(sender: string): boolean {
  return sender === "agent" || sender === "assistant";
}

export function isIntentOnlyText(text: string): boolean {
  const n = text.replace(/['']/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  if (!n) return false;
  const v = "(?:start|begin|check|inspect|look|read|open|review|edit|update|patch|fix|run|test|verify|investigate|continue|proceed|work|implement|make|add|wire|trace|debug|rewrite|write|create|generate|build|validate|resolve)";
  const g = "(?:checking|inspecting|reading|opening|reviewing|editing|updating|patching|fixing|running|testing|verifying|investigating|continuing|proceeding|implementing|adding|wiring|tracing|debugging|rewriting|writing|creating|generating|building|validating|resolving)";
  return [
    new RegExp(`\\bi'll\\s+${v}\\b`),
    new RegExp(`\\bi will\\s+${v}\\b`),
    new RegExp(`\\bi'm going to\\s+${v}\\b`),
    new RegExp(`\\bi can\\s+${v}\\b`),
    new RegExp(`\\blet me\\s+${v}\\b`),
    new RegExp(`\\bnext,?\\s+i(?:'ll| will)\\s+${v}\\b`),
    new RegExp(`\\bnow\\s+i(?:'ll| will)\\s+${v}\\b`),
    new RegExp(`^${g}\\b`),
    new RegExp(`\\b${g}\\s+(?:now|next|the|this|with|using)\\b`),
  ].some((p) => p.test(n));
}
