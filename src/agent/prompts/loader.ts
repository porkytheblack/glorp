import { BUNDLED_PROMPTS } from "./bundled.ts";

export function readPrompt(relativePath: string, vars: Record<string, string> = {}): string {
  const raw = BUNDLED_PROMPTS[relativePath];
  if (raw === undefined) throw new Error(`Unknown bundled prompt: ${relativePath}`);
  return interpolate(raw, vars).trim();
}

function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_m, key: string) => vars[key] ?? "");
}
