import type { Args } from "./args.ts";

export function envHasProvider(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GROQ_API_KEY,
  );
}

/** Headless guard: bail out clearly if no provider is reachable. */
export function ensureApiKey(args: Args): void {
  if (args.provider) return;
  if (envHasProvider()) return;
  console.error(`
glorp needs a model configured. options:
  • run \`glorp\` interactively to onboard (saves keys to ~/.glorp/credentials.json)
  • set one of: ANTHROPIC_API_KEY · OPENAI_API_KEY · OPENROUTER_API_KEY · GEMINI_API_KEY · GROQ_API_KEY
  • pass --provider <name> --model <id> on the command line
`);
  process.exit(2);
}
