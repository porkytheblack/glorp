export function firstItems(items: string[], limit = 20): string {
  if (items.length === 0) return "";
  const shown = items.slice(0, limit).join("\n");
  const omitted = items.length > limit ? `\n... [${items.length - limit} more omitted]` : "";
  return shown + omitted;
}

export function compactText(text: string, maxLines = 24, maxChars = 4000): string {
  const lines = text.split("\n");
  const headLines = lines.slice(0, maxLines);
  let compact = headLines.join("\n");
  if (compact.length > maxChars) compact = `${compact.slice(0, maxChars)}\n... [truncated summary text]`;
  if (lines.length > maxLines) compact += `\n... [${lines.length - maxLines} more lines omitted]`;
  return compact;
}

export function lineCount(text: string): number {
  return text.length === 0 ? 0 : text.split("\n").length;
}
