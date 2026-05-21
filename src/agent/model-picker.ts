import type { ModelAdapter } from "glove-core/core";

export interface PickModelOptions {
  provider?: string;
  model?: string;
}

/**
 * Pick a model based on opts + env vars. Imports the adapter modules
 * lazily so we don't drag in the AWS SDK unless someone actually asks
 * for Bedrock (its transitive @smithy/core has broken subpath exports).
 */
export async function pickModel(opts: PickModelOptions): Promise<ModelAdapter> {
  const provider =
    opts.provider ??
    (process.env.ANTHROPIC_API_KEY
      ? "anthropic"
      : process.env.OPENAI_API_KEY
        ? "openai"
        : process.env.OPENROUTER_API_KEY
          ? "openrouter"
          : process.env.GEMINI_API_KEY
            ? "gemini"
            : "anthropic");
  switch (provider) {
    case "anthropic": {
      const { AnthropicAdapter } = await import("glove-core/models/anthropic");
      return new AnthropicAdapter({
        model: opts.model ?? "claude-sonnet-4-20250514",
        stream: true,
      });
    }
    case "openai": {
      const { OpenAICompatAdapter } = await import("glove-core/models/openai-compat");
      return new OpenAICompatAdapter({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: "https://api.openai.com/v1",
        model: opts.model ?? "gpt-4.1",
        stream: true,
      });
    }
    case "openrouter": {
      const { OpenAICompatAdapter } = await import("glove-core/models/openai-compat");
      return new OpenAICompatAdapter({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
        model: opts.model ?? "anthropic/claude-sonnet-4",
        stream: true,
      });
    }
    case "gemini": {
      const { OpenAICompatAdapter } = await import("glove-core/models/openai-compat");
      return new OpenAICompatAdapter({
        apiKey: process.env.GEMINI_API_KEY,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
        model: opts.model ?? "gemini-2.5-flash",
        stream: true,
      });
    }
    case "groq": {
      const { OpenAICompatAdapter } = await import("glove-core/models/openai-compat");
      return new OpenAICompatAdapter({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: "https://api.groq.com/openai/v1",
        model: opts.model ?? "llama-3.3-70b-versatile",
        stream: true,
      });
    }
    case "ollama": {
      const { OpenAICompatAdapter } = await import("glove-core/models/openai-compat");
      return new OpenAICompatAdapter({
        apiKey: "ollama",
        baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
        model: opts.model ?? "llama3.2",
        stream: true,
      });
    }
    default: {
      // Generic OpenAI-compat fallback — caller must supply OPENAI_API_KEY +
      // an OPENAI_BASE_URL via env or pass --provider openai.
      const { OpenAICompatAdapter } = await import("glove-core/models/openai-compat");
      return new OpenAICompatAdapter({
        apiKey: process.env.OPENAI_API_KEY ?? "",
        baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        model: opts.model ?? provider,
        stream: true,
      });
    }
  }
}
