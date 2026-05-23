export type KnownProvider =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "gemini"
  | "groq"
  | "mimo"
  | "ollama";

export type ProviderId = KnownProvider | string;

export const CUSTOM_PROVIDER_ADAPTERS = [
  { id: "openai-compat", label: "OpenAI-compatible", description: "Generic /v1/chat/completions endpoint" },
  { id: "mimo", label: "Xiaomi MiMo", description: "MiMo reasoning_content adapter" },
] as const;

export type CustomProviderAdapter = (typeof CUSTOM_PROVIDER_ADAPTERS)[number]["id"];

export interface KnownProviderMeta {
  id: KnownProvider;
  label: string;
  envVar: string;
  description: string;
  defaultModels: string[];
  needsApiKey: boolean;
  reasoningCapableModelMatchers: RegExp[];
}

export const KNOWN_PROVIDERS: KnownProviderMeta[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    envVar: "ANTHROPIC_API_KEY",
    description: "Claude — recommended for coding tasks",
    defaultModels: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-sonnet-4-20250514"],
    needsApiKey: true,
    reasoningCapableModelMatchers: [],
  },
  {
    id: "openai",
    label: "OpenAI (GPT)",
    envVar: "OPENAI_API_KEY",
    description: "GPT-5, GPT-4.1, o-series",
    defaultModels: ["gpt-5", "gpt-4.1", "o4-mini", "o3", "o3-mini"],
    needsApiKey: true,
    reasoningCapableModelMatchers: [/^gpt-5/, /^o[3-9]/, /^o\d+-mini/],
  },
  {
    id: "openrouter",
    label: "OpenRouter (any model)",
    envVar: "OPENROUTER_API_KEY",
    description: "Routed access to most models via one key",
    defaultModels: [
      "anthropic/claude-sonnet-4", "openai/gpt-5", "deepseek/deepseek-r1",
      "deepseek/deepseek-chat-v4", "qwen/qwen-2.5-72b-instruct", "x-ai/grok-2",
    ],
    needsApiKey: true,
    reasoningCapableModelMatchers: [
      /\/gpt-5/, /\/o[3-9]/, /\/deepseek-r1/, /\/deepseek-chat-v4/,
      /\/qwen.*thinking/, /\/glm-/, /\/kimi-/, /\/minimax/, /\/mimo/,
    ],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    envVar: "GEMINI_API_KEY",
    description: "Gemini 2.5 family",
    defaultModels: ["gemini-2.5-pro", "gemini-2.5-flash"],
    needsApiKey: true,
    reasoningCapableModelMatchers: [],
  },
  {
    id: "groq",
    label: "Groq (fast)",
    envVar: "GROQ_API_KEY",
    description: "Fast inference for Llama and DeepSeek-R1 distills",
    defaultModels: ["llama-3.3-70b-versatile", "deepseek-r1-distill-llama-70b", "qwen-2.5-coder-32b"],
    needsApiKey: true,
    reasoningCapableModelMatchers: [/deepseek-r1/, /qwen.*coder/],
  },
  {
    id: "mimo",
    label: "Xiaomi MiMo",
    envVar: "MIMO_API_KEY",
    description: "Xiaomi MiMo reasoning models",
    defaultModels: ["mimo-v2.5", "mimo-v2.5-pro", "mimo-v2-pro", "mimo-v2-omni"],
    needsApiKey: true,
    reasoningCapableModelMatchers: [/^mimo/],
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    envVar: "",
    description: "Local models — no API key needed",
    defaultModels: ["llama3.3", "qwen2.5-coder", "deepseek-r1"],
    needsApiKey: false,
    reasoningCapableModelMatchers: [/deepseek-r1/, /qwen.*thinking/],
  },
];

export function findKnownProvider(id: string): KnownProviderMeta | undefined {
  return KNOWN_PROVIDERS.find((p) => p.id === id);
}

export interface ProviderConfig {
  type: "known" | "custom";
  id: string;
  adapter?: CustomProviderAdapter;
  baseURL?: string;
  apiKey?: string;
}

/** Does the given (provider, model) combo accept a reasoning effort hint? */
export function modelAcceptsReasoning(providerId: string, model: string): boolean {
  const known = findKnownProvider(providerId);
  if (known) return known.reasoningCapableModelMatchers.some((re) => re.test(model));
  return /gpt-5|^o[3-9]|deepseek-r1|deepseek-chat-v4|glm-|kimi-|minimax|mimo|qwen.*thinking/.test(model);
}
