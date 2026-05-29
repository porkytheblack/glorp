/**
 * Dependency-free fuzzy matcher for the Helix-style menu primitives.
 * Case-insensitive subsequence match; scoring rewards consecutive runs
 * and start-of-word / boundary matches. `ranges` mark matched chars for
 * highlighting (inclusive start, exclusive end).
 */

export interface FuzzyResult {
  matched: boolean;
  score: number;
  ranges: Array<[number, number]>;
}

const BOUNDARY = /[\s\-_/.@:·]/;

function isBoundary(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1]!;
  if (BOUNDARY.test(prev)) return true;
  // camelCase boundary: lower→Upper transition.
  return prev === prev.toLowerCase() && text[i] !== text[i]!.toLowerCase();
}

/** Subsequence fuzzy match; returns score + matched index ranges. */
export function fuzzyMatch(query: string, text: string): FuzzyResult {
  if (query.length === 0) return { matched: true, score: 0, ranges: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const indices: number[] = [];
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!;
    while (ti < t.length && t[ti] !== ch) ti++;
    if (ti >= t.length) return { matched: false, score: 0, ranges: [] };
    indices.push(ti);
    ti++;
  }

  let score = 0;
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i]!;
    score += 1;
    if (isBoundary(text, idx)) score += 8;            // word boundary bonus
    if (i > 0 && indices[i - 1] === idx - 1) score += 6; // consecutive bonus
    score -= idx * 0.05;                               // earlier match preferred
  }
  if (indices[0] === 0) score += 4;                    // matches at very start
  score -= (text.length - q.length) * 0.02;            // prefer tighter matches

  return { matched: true, score, ranges: toRanges(indices) };
}

/** Collapse a sorted index list into [start, end) ranges. */
function toRanges(indices: number[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const idx of indices) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === idx) last[1] = idx + 1;
    else ranges.push([idx, idx + 1]);
  }
  return ranges;
}

/** Filter to matched items, sorted by score desc, stable on original order. */
export function fuzzyFilter<T>(
  query: string,
  items: T[],
  getText: (item: T) => string,
): Array<{ item: T; result: FuzzyResult }> {
  const out: Array<{ item: T; result: FuzzyResult; order: number }> = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const result = fuzzyMatch(query, getText(item));
    if (result.matched) out.push({ item, result, order: i });
  }
  out.sort((a, b) => (b.result.score - a.result.score) || (a.order - b.order));
  return out.map(({ item, result }) => ({ item, result }));
}
