/**
 * Structural sniffing for declared deliverables — the built-in, toolchain-free
 * half of deliverable verification. A template's `verify.command` can go deep
 * (ffprobe, reopening with a library), but it is best-effort: a missing
 * toolchain skips it. These magic-byte checks always run for contract-gated
 * tasks, so a "pdf" that is actually a python script, a truncated PDF, or an
 * office file that isn't a zip can never be declared done. Unknown extensions
 * pass — we can't judge them.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface SniffVerdict {
  ok: boolean;
  /** Present when !ok: what looked wrong, in plain terms the agent can fix. */
  reason?: string;
}

const startsWith = (buf: Buffer, sig: readonly number[], offset = 0): boolean =>
  buf.length >= offset + sig.length && sig.every((b, i) => buf[offset + i] === b);

/** Structurally sniff a deliverable's bytes by extension. */
export function sniffDeliverableBytes(filename: string, bytes: Buffer): SniffVerdict {
  if (bytes.length === 0) return { ok: false, reason: "the file is empty" };
  const ext = path.extname(filename).toLowerCase().replace(/^\./, "");
  switch (ext) {
    case "pdf": {
      const head = bytes.subarray(0, 1024).toString("latin1");
      if (!head.includes("%PDF-")) {
        return { ok: false, reason: "it does not start with a %PDF- header — it is not a PDF" };
      }
      const tail = bytes.subarray(Math.max(0, bytes.length - 2048)).toString("latin1");
      if (!tail.includes("%%EOF")) {
        return { ok: false, reason: "it is truncated — no %%EOF trailer; re-render it" };
      }
      return { ok: true };
    }
    case "docx": case "pptx": case "xlsx":
    case "odt": case "odp": case "ods": case "epub": case "zip":
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
        ? { ok: true }
        : { ok: false, reason: `it is not a valid .${ext} file (not a zip archive)` };
    case "png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])
        ? { ok: true }
        : { ok: false, reason: "it is not a valid PNG image" };
    case "jpg": case "jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff])
        ? { ok: true }
        : { ok: false, reason: "it is not a valid JPEG image" };
    case "gif":
      return bytes.subarray(0, 6).toString("latin1").startsWith("GIF8")
        ? { ok: true }
        : { ok: false, reason: "it is not a valid GIF image" };
    case "webp":
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        bytes.subarray(8, 12).toString("latin1") === "WEBP"
        ? { ok: true }
        : { ok: false, reason: "it is not a valid WebP image" };
    case "mp4": case "mov": case "m4a":
      return bytes.subarray(4, 8).toString("latin1") === "ftyp"
        ? { ok: true }
        : { ok: false, reason: `it is not a valid .${ext} container (no ftyp box) — render the real media` };
    case "webm": case "mkv":
      return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])
        ? { ok: true }
        : { ok: false, reason: `it is not a valid .${ext} container` };
    default:
      return { ok: true };
  }
}

/**
 * Sniff a file on disk (uploads-relative under `root`). Read failures report
 * as not-ok so a vanished file can't slip past as "unjudgeable".
 */
export function sniffDeliverableFile(root: string, rel: string): SniffVerdict {
  try {
    return sniffDeliverableBytes(rel, fs.readFileSync(path.join(root, rel)));
  } catch (e) {
    return { ok: false, reason: `it could not be read: ${e instanceof Error ? e.message : String(e)}` };
  }
}
