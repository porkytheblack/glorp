/**
 * Read image data from the system clipboard using platform-native commands.
 * Returns null if no image is on the clipboard.
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface ClipboardImage {
  data: string;
  media_type: string;
}

export async function readClipboardImage(): Promise<ClipboardImage | null> {
  if (process.platform === "darwin") return readMac();
  if (process.platform === "linux") return readLinux();
  return null;
}

async function readMac(): Promise<ClipboardImage | null> {
  const info = await run("osascript", ["-e", "clipboard info"]);
  if (!info) return null;
  const text = info.toString("utf-8");
  const hasPng = text.includes("«class PNGf»");
  const hasTiff = text.includes("«class TIFF»");
  if (!hasPng && !hasTiff) return null;

  const cls = hasPng ? "PNGf" : "TIFF";
  const ts = Date.now();
  const tmp = path.join(os.tmpdir(), `glorp-clip-${ts}.raw`);
  const script = [
    `set f to open for access POSIX file "${tmp}" with write permission`,
    `write (the clipboard as «class ${cls}») to f`,
    `close access f`,
  ];
  if (await run("osascript", script.flatMap((s) => ["-e", s])) === null) return null;

  try {
    let buf = fs.readFileSync(tmp);
    if (buf.length === 0) { cleanup(tmp); return null; }
    // Already valid PNG — return directly
    if (isPng(buf)) { cleanup(tmp); return { data: buf.toString("base64"), media_type: "image/png" }; }
    // TIFF or other — convert to PNG via sips (built into macOS)
    const pngPath = path.join(os.tmpdir(), `glorp-clip-${ts}.png`);
    if (await run("sips", ["-s", "format", "png", tmp, "--out", pngPath]) === null) { cleanup(tmp); return null; }
    cleanup(tmp);
    buf = fs.readFileSync(pngPath);
    cleanup(pngPath);
    return buf.length > 0 ? { data: buf.toString("base64"), media_type: "image/png" } : null;
  } catch {
    cleanup(tmp);
    return null;
  }
}

function isPng(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

function cleanup(...paths: string[]) {
  for (const p of paths) try { fs.unlinkSync(p); } catch {}
}

async function readLinux(): Promise<ClipboardImage | null> {
  // Try xclip (X11), then wl-paste (Wayland).
  const buf = await run("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"])
    ?? await run("wl-paste", ["-t", "image/png", "--no-newline"]);
  if (!buf || buf.length === 0) return null;
  return { data: buf.toString("base64"), media_type: "image/png" };
}

function run(cmd: string, args: string[]): Promise<Buffer | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, encoding: "buffer", maxBuffer: 20 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout));
  });
}
