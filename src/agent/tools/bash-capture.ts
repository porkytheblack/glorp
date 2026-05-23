import { lineCount } from "./summaries.ts";

const MAX_OUTPUT_BYTES_PER_STREAM = 64 * 1024;
const OUTPUT_HEAD_BYTES = 48 * 1024;
const OUTPUT_TAIL_BYTES = 16 * 1024;

export const STREAM_LIMITS = {
  MAX_OUTPUT_BYTES_PER_STREAM,
  OUTPUT_HEAD_BYTES,
  OUTPUT_TAIL_BYTES,
};

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\s+\/(\s|$)/,
  /:\(\)\{.*\}\s*;:/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  />+\s*\/dev\/(sd[a-z]|nvme\d+n\d+|vd[a-z]|xvd[a-z])/,
];

export function dangerousReason(cmd: string): string | null {
  for (const p of DANGEROUS_PATTERNS) {
    if (p.test(cmd)) return `Command matches a destructive pattern (${p}). Refusing.`;
  }
  return null;
}

export function cleanTerminalOutput(text: string): string {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[=>]/g, "")
    .split(/\r|\n/)
    .filter((line, index, lines) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      return index === lines.length - 1 || trimmed !== lines[index + 1]?.trim();
    })
    .join("\n");
}

export function newlineCount(text: string): number {
  return (text.match(/\n/g) ?? []).length;
}

export function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf-8");
}

function takeFirstBytes(text: string, bytes: number): string {
  const buf = Buffer.from(text, "utf-8");
  return buf.length <= bytes ? text : buf.subarray(0, bytes).toString("utf-8");
}

function takeLastBytes(text: string, bytes: number): string {
  const buf = Buffer.from(text, "utf-8");
  return buf.length <= bytes ? text : buf.subarray(buf.length - bytes).toString("utf-8");
}

export interface StreamCapture {
  push(buf: Buffer): void;
  value(): string;
  truncated(): boolean;
}

/**
 * Bounded streaming buffer for stdout/stderr capture. Keeps full output up to
 * MAX_OUTPUT_BYTES_PER_STREAM; past that, retains head+tail and a marker line
 * showing how much was elided.
 */
export function makeStreamCapture(label: "stdout" | "stderr"): StreamCapture {
  let full = "";
  let head = "";
  let tail = "";
  let totalBytes = 0;
  let totalNewlines = 0;
  let truncated = false;
  return {
    push(buf) {
      const text = buf.toString("utf-8");
      totalBytes += buf.length;
      totalNewlines += newlineCount(text);
      if (!truncated && totalBytes <= MAX_OUTPUT_BYTES_PER_STREAM) {
        full += text;
        return;
      }
      if (!truncated) {
        truncated = true;
        const combined = full + text;
        head = takeFirstBytes(combined, OUTPUT_HEAD_BYTES);
        tail = takeLastBytes(combined, OUTPUT_TAIL_BYTES);
        full = "";
        return;
      }
      tail = takeLastBytes(tail + text, OUTPUT_TAIL_BYTES);
    },
    value() {
      if (!truncated) return cleanTerminalOutput(full);
      const totalLines = totalNewlines + 1;
      const retainedLines = lineCount(head) + lineCount(tail);
      const omittedLines = Math.max(0, totalLines - retainedLines);
      return cleanTerminalOutput(
        `${head}\n... [${label} truncated: ${omittedLines} lines elided; ` +
          `${totalBytes} bytes total, kept ${byteLength(head) + byteLength(tail)} bytes head+tail]\n${tail}`,
      );
    },
    truncated() { return truncated; },
  };
}
