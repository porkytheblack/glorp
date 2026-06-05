import { z } from "zod";
import * as fs from "node:fs";
import type { GloveFoldArgs } from "glove-core/glove";
import { resolveSafePath, relPath, isFile } from "./fs-shared.ts";

/**
 * Lets the agent actually *see* an image file — a screenshot it captured, a
 * rendered slide, a chart, a design export. This is the validation primitive
 * for anything visual.
 *
 * glove-core tool results are text-only on the way to the model, so the image
 * cannot ride back inside this tool's result. Instead we stash the base64 on
 * `renderData.glorpImage` (kept by the store, never sent verbatim) and the
 * `withImageToolResults` model wrapper lifts it into a user-role image content
 * part right after the tool-result message — the one channel the model adapter
 * renders as a real image. The text `data` here is just the human/agent-facing
 * confirmation.
 */

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB on disk — base64 inflates ~33%.

/** Key the model wrapper looks for on a tool result's renderData. */
export const GLORP_IMAGE_RENDER_KEY = "glorpImage";

const EXT_MEDIA_TYPE: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

interface ViewImageRenderData {
  [GLORP_IMAGE_RENDER_KEY]: { media_type: string; data: string };
  path: string;
  bytes: number;
}

export function viewImageTool(workspace: string): GloveFoldArgs<{ path: string }> {
  return {
    name: "view_image",
    description:
      "Load an image file (PNG/JPEG/GIF/WebP) so you can SEE it — use this to inspect a " +
      "screenshot, a rendered slide/page, a chart, or any visual deliverable. The image is " +
      "attached to the current turn for you to examine. This is how you visually validate " +
      "web/UI and presentation work: capture a screenshot (e.g. with playwright), then view it.",
    inputSchema: z.object({
      path: z.string().describe("Path to the image file (absolute or relative to the workspace)"),
    }),
    async do(input) {
      const abs = resolveSafePath(workspace, input.path);
      const rel = relPath(workspace, abs);
      if (!(await isFile(abs))) {
        return { status: "error", data: null, message: `Not a file: ${rel}` };
      }
      const ext = extOf(rel);
      const declared = EXT_MEDIA_TYPE[ext];
      if (!declared) {
        return {
          status: "error",
          data: null,
          message: `Unsupported image type "${ext || "(none)"}" for ${rel}. Supported: ${Object.keys(EXT_MEDIA_TYPE).join(", ")}.`,
        };
      }
      const stat = await fs.promises.stat(abs);
      if (stat.size > MAX_IMAGE_BYTES) {
        return {
          status: "error",
          data: null,
          message: `Image ${rel} is ${stat.size} bytes — over the ${MAX_IMAGE_BYTES}-byte limit. Resize or crop it (e.g. scale the screenshot down) and try again.`,
        };
      }
      const buf = await fs.promises.readFile(abs);
      const sniffed = sniffMediaType(buf);
      if (!sniffed) {
        return {
          status: "error",
          data: null,
          message: `${rel} does not have a recognizable image header (PNG/JPEG/GIF/WebP). It may be corrupt or not an image — re-export it and try again.`,
        };
      }
      if (sniffed !== declared) {
        return {
          status: "error",
          data: null,
          message: `${rel} has extension ${ext} but its bytes look like ${sniffed}. Rename it or re-export so the type matches.`,
        };
      }
      const media_type = sniffed;
      const kb = Math.max(1, Math.round(stat.size / 1024));
      return {
        status: "success",
        data: `Loaded ${rel} (${media_type}, ${kb} KB). The image is attached to this turn — examine it before continuing.`,
        renderData: {
          [GLORP_IMAGE_RENDER_KEY]: { media_type, data: buf.toString("base64") },
          path: rel,
          bytes: stat.size,
        } satisfies ViewImageRenderData,
      };
    },
  };
}

function extOf(p: string): string {
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const name = slash >= 0 ? p.slice(slash + 1) : p;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** Identify the real image type from magic bytes, or null if unrecognised. */
function sniffMediaType(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (buf.length >= 6 && buf.toString("ascii", 0, 6).match(/^GIF8[79]a$/)) {
    return "image/gif";
  }
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}
