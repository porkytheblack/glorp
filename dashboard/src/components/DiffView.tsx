/**
 * Dependency-free code diff renderer. Two input modes:
 *   - `diff`  → a pre-computed unified-diff / git-diff string (apply_patch).
 *   - before/after pair → an LCS line diff is computed here (edit, write).
 *
 * Additions sit on a green-tinted row, deletions on a red-tinted row, context
 * is muted — matching the Glorp palette and the terminal/monospace aesthetic.
 */

type DiffKind = "add" | "del" | "context" | "meta";

interface DiffLine {
  kind: DiffKind;
  text: string;
}

const ROW: Record<DiffKind, string> = {
  add: "bg-glorp-accent/10 text-glorp-accent",
  del: "bg-glorp-error/10 text-glorp-error",
  context: "text-glorp-muted",
  meta: "text-glorp-user",
};

const SIGN: Record<DiffKind, string> = { add: "+", del: "-", context: " ", meta: " " };

/** Classify a single line of a unified-diff string into a row kind. */
function classifyUnified(line: string): DiffLine {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@") || line.startsWith("diff ")) {
    return { kind: "meta", text: line };
  }
  if (line.startsWith("+")) return { kind: "add", text: line.slice(1) };
  if (line.startsWith("-")) return { kind: "del", text: line.slice(1) };
  return { kind: "context", text: line.startsWith(" ") ? line.slice(1) : line };
}

/** Longest-common-subsequence line diff for a before/after pair. */
function diffLines(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = length of LCS of a[i:] and b[j:].
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "context", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: "del", text: a[i]! });
      i++;
    } else {
      out.push({ kind: "add", text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ kind: "del", text: a[i++]! });
  while (j < m) out.push({ kind: "add", text: b[j++]! });
  return out;
}

interface PairProps {
  before: string;
  after: string;
  filePath?: string;
  diff?: undefined;
}

interface UnifiedProps {
  diff: string;
  filePath?: string;
  before?: undefined;
  after?: undefined;
}

export type DiffViewProps = PairProps | UnifiedProps;

export function DiffView(props: DiffViewProps) {
  const lines: DiffLine[] =
    props.diff !== undefined
      ? props.diff.split("\n").map(classifyUnified)
      : diffLines(props.before, props.after);

  const added = lines.filter((l) => l.kind === "add").length;
  const removed = lines.filter((l) => l.kind === "del").length;

  return (
    <div className="overflow-hidden rounded border border-glorp-border bg-glorp-bg font-mono text-[12px]">
      <div className="flex items-center justify-between border-b border-glorp-border bg-glorp-surface-2 px-2 py-1">
        <span className="truncate text-glorp-text">{props.filePath ?? "diff"}</span>
        <span className="shrink-0 tabular-nums">
          <span className="text-glorp-accent">+{added}</span>{" "}
          <span className="text-glorp-error">-{removed}</span>
        </span>
      </div>
      <div className="max-h-80 overflow-auto">
        {lines.map((line, idx) => (
          <div key={idx} className={`flex whitespace-pre ${ROW[line.kind]}`}>
            <span className="w-4 shrink-0 select-none text-center opacity-60">{SIGN[line.kind]}</span>
            <span className="flex-1 break-words pr-2">{line.text || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
