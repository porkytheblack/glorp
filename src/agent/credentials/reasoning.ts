import { findKnownProvider, modelAcceptsReasoning, type ProviderConfig } from "./providers.ts";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export type ReasoningConfig =
  | { kind: "off" }
  | { kind: "effort"; effort: ReasoningEffort }
  | { kind: "thinking"; budget_tokens: number }
  | { kind: "reasoningObject"; effort: Exclude<ReasoningEffort, "minimal">; max_tokens?: number }
  | { kind: "qwenThinking"; enabled: boolean; budget_tokens?: number };

export type ActiveReasoningKind = "effort" | "thinking" | "reasoningObject" | "qwenThinking";

export function reasoningProviderId(providerId: string, provider?: ProviderConfig): string {
  if (provider?.type === "custom" && provider.adapter === "mimo") return "mimo";
  return providerId;
}

/** Upgrade old bare-effort strings on disk to the discriminated union. */
export function normaliseReasoning(r: ReasoningConfig | ReasoningEffort | undefined): ReasoningConfig {
  if (!r) return { kind: "off" };
  if (typeof r === "string") return { kind: "effort", effort: r };
  return r;
}

export function reasoningLabel(r: ReasoningConfig): string {
  switch (r.kind) {
    case "off": return "off";
    case "effort": return r.effort;
    case "thinking": return `${r.budget_tokens} budget`;
    case "reasoningObject": return r.max_tokens ? `${r.effort} · ${r.max_tokens}` : r.effort;
    case "qwenThinking":
      return r.enabled ? (r.budget_tokens ? `on · ${r.budget_tokens} budget` : "on") : "off";
  }
}

export function reasoningKindFor(providerId: string, model: string): ActiveReasoningKind | null {
  if (!modelAcceptsReasoning(providerId, model)) return null;
  if (providerId === "anthropic") return "thinking";
  if (providerId === "mimo") return "effort";
  if (providerId === "openrouter") return "reasoningObject";
  if (/^qwen3/.test(model) || /\/qwen3/.test(model)) return "qwenThinking";
  return "effort";
}

export interface ReasoningOption {
  label: string;
  description?: string;
  value: ReasoningConfig;
}

const EFFORT_OPTIONS: ReasoningOption[] = [
  { label: "low", description: "fast, lighter reasoning", value: { kind: "effort", effort: "low" } },
  { label: "medium", description: "balanced", value: { kind: "effort", effort: "medium" } },
  { label: "high (recommended for reasoning models)", description: "deep reasoning", value: { kind: "effort", effort: "high" } },
];

const THINKING_OPTIONS: ReasoningOption[] = [
  { label: "1k budget", description: "lightweight thinking", value: { kind: "thinking", budget_tokens: 1024 } },
  { label: "4k budget", description: "moderate (recommended)", value: { kind: "thinking", budget_tokens: 4096 } },
  { label: "16k budget", description: "deep thinking", value: { kind: "thinking", budget_tokens: 16384 } },
  { label: "32k budget", description: "max — slow and expensive", value: { kind: "thinking", budget_tokens: 32768 } },
];

const REASONING_OBJECT_OPTIONS: ReasoningOption[] = [
  { label: "low", description: "fast OpenRouter route", value: { kind: "reasoningObject", effort: "low" } },
  { label: "medium", value: { kind: "reasoningObject", effort: "medium" } },
  { label: "high (recommended)", value: { kind: "reasoningObject", effort: "high" } },
  { label: "high · 4k cap", value: { kind: "reasoningObject", effort: "high", max_tokens: 4000 } },
  { label: "high · 16k cap", value: { kind: "reasoningObject", effort: "high", max_tokens: 16000 } },
];

const QWEN_THINKING_OPTIONS: ReasoningOption[] = [
  { label: "on (auto budget)", description: "dashscope enable_thinking", value: { kind: "qwenThinking", enabled: true } },
  { label: "on · 1k budget", value: { kind: "qwenThinking", enabled: true, budget_tokens: 1024 } },
  { label: "on · 4k budget", value: { kind: "qwenThinking", enabled: true, budget_tokens: 4096 } },
];

export function reasoningOptionsFor(providerId: string, model: string): ReasoningOption[] {
  const kind = reasoningKindFor(providerId, model);
  const off: ReasoningOption = { label: "off — let the model decide", value: { kind: "off" } };
  if (kind === null) return [];
  switch (kind) {
    case "effort": {
      const supportsMinimal = providerId === "openai" && /^gpt-5/.test(model);
      const opts: ReasoningOption[] = [off];
      if (supportsMinimal) opts.push({ label: "minimal", description: "GPT-5 only — least thinking", value: { kind: "effort", effort: "minimal" } });
      return [...opts, ...EFFORT_OPTIONS];
    }
    case "thinking": return [off, ...THINKING_OPTIONS];
    case "reasoningObject": return [off, ...REASONING_OBJECT_OPTIONS];
    case "qwenThinking": return [off, ...QWEN_THINKING_OPTIONS];
    default: {
      const _exhaustive: never = kind;
      return [_exhaustive];
    }
  }
}

export { findKnownProvider, modelAcceptsReasoning };
