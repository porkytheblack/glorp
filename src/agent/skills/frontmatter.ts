/**
 * Tiny YAML-frontmatter parser. Supports the subset we actually use:
 *   key: value          → string
 *   key: [a, b, c]      → array of strings
 *   key:                → start of block, followed by `- item` lines
 *     - item
 *
 * No nesting, no anchors, no flow scalars beyond single-line arrays. If
 * the file doesn't start with `---\n`, treats the whole thing as body
 * with no frontmatter.
 */
export function parseFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const normalised = raw.replace(/\r\n/g, "\n");
  if (!normalised.startsWith("---\n")) {
    return { frontmatter: {}, body: normalised };
  }
  const closeIdx = normalised.indexOf("\n---", 4);
  if (closeIdx === -1) {
    return { frontmatter: {}, body: normalised };
  }
  const block = normalised.slice(4, closeIdx);
  const afterCloseStart = closeIdx + 4;
  const newlineAfter = normalised.indexOf("\n", afterCloseStart);
  const body = newlineAfter === -1 ? "" : normalised.slice(newlineAfter + 1);
  return { frontmatter: parseBlock(block), body };
}

function parseBlock(block: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = block.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) {
      i++;
      continue;
    }
    const key = line.slice(0, colon).trim();
    const rest = line.slice(colon + 1).trim();
    if (rest === "") {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const m = lines[j]!.match(/^\s*-\s+(.+)$/);
        if (!m) break;
        items.push(unquote(m[1]!.trim()));
        j++;
      }
      out[key] = items.length > 0 ? items : "";
      i = j;
      continue;
    }
    out[key] = parseScalar(rest);
    i++;
  }
  return out;
}

function parseScalar(rest: string): unknown {
  if (rest.startsWith("[") && rest.endsWith("]")) {
    const inner = rest.slice(1, -1).trim();
    return inner === "" ? [] : inner.split(",").map((s) => unquote(s.trim()));
  }
  return unquote(rest);
}

function unquote(s: string): string {
  if (s.length >= 2 && (s.startsWith('"') || s.startsWith("'"))) {
    const q = s[0];
    if (s.endsWith(q)) return s.slice(1, -1);
  }
  return s;
}
