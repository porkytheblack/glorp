export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function xmlSection(
  tag: string,
  attrs: Record<string, string | number | boolean | undefined>,
  body: string,
): string {
  const renderedAttrs = Object.entries(attrs)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}="${escapeAttr(String(value))}"`)
    .join(" ");
  const open = renderedAttrs ? `<${tag} ${renderedAttrs}>` : `<${tag}>`;
  return `${open}\n${body.trim()}\n</${tag}>`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
