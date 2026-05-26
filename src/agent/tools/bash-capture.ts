/** Streaming output capture with head+tail truncation for bash tool. */

const MAX_OUTPUT_BYTES = 64 * 1024;
const HEAD_BYTES = 48 * 1024;
const TAIL_BYTES = 16 * 1024;

export function cleanTerminalOutput(text: string): string {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[=>]/g, "")
    .split(/\r|\n/)
    .filter((line, i, lines) => {
      const t = line.trim();
      if (!t) return true;
      return i === lines.length - 1 || t !== lines[i + 1]?.trim();
    })
    .join("\n");
}

function newlineCount(text: string): number {
  return (text.match(/\n/g) ?? []).length;
}

function byteLen(text: string): number {
  return Buffer.byteLength(text, "utf-8");
}

function takeFirst(text: string, bytes: number): string {
  const buf = Buffer.from(text, "utf-8");
  return buf.length <= bytes ? text : buf.subarray(0, bytes).toString("utf-8");
}

function takeLast(text: string, bytes: number): string {
  const buf = Buffer.from(text, "utf-8");
  return buf.length <= bytes ? text : buf.subarray(buf.length - bytes).toString("utf-8");
}

export interface StreamCapture {
  push(buf: Buffer): void;
  value(): string;
  truncated(): boolean;
}

export function makeStreamCapture(label: "stdout" | "stderr"): StreamCapture {
  let full = "";
  let head = "";
  let tail = "";
  let totalBytes = 0;
  let totalNewlines = 0;
  let isTruncated = false;

  return {
    push(buf: Buffer) {
      const text = buf.toString("utf-8");
      totalBytes += buf.length;
      totalNewlines += newlineCount(text);
      if (!isTruncated && totalBytes <= MAX_OUTPUT_BYTES) {
        full += text;
        return;
      }
      if (!isTruncated) {
        isTruncated = true;
        const combined = full + text;
        head = takeFirst(combined, HEAD_BYTES);
        tail = takeLast(combined, TAIL_BYTES);
        full = "";
        return;
      }
      tail = takeLast(tail + text, TAIL_BYTES);
    },
    value() {
      if (!isTruncated) return cleanTerminalOutput(full);
      const totalLines = totalNewlines + 1;
      const kept = newlineCount(head) + 1 + (newlineCount(tail) + 1);
      const omitted = Math.max(0, totalLines - kept);
      return cleanTerminalOutput(
        `${head}\n... [${label} truncated: ${omitted} lines elided; ` +
        `${totalBytes} bytes total, kept ${byteLen(head) + byteLen(tail)} bytes head+tail]\n${tail}`,
      );
    },
    truncated: () => isTruncated,
  };
}
