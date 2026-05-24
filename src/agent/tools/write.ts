import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import type { GloveFoldArgs } from "glove-core";
import { resolveSafePath, relPath } from "./fs-shared.ts";

/**
 * File extensions whose contents are not human-readable UTF-8. The `write`
 * tool sends `content` straight through `fs.writeFile(..., "utf-8")`, so
 * letting the model dump a string like "PLACEHOLDER" into a `.docx` produces
 * a corrupt file that nothing can open. Refuse instead and tell the caller
 * to use the right generator.
 */
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  // Office
  ".docx", ".doc", ".dotx", ".dot",
  ".xlsx", ".xls", ".xlsm", ".xlsb",
  ".pptx", ".ppt",
  ".odt", ".ods", ".odp",
  ".pages", ".numbers", ".key",
  // Documents
  ".pdf", ".rtf",
  // Images
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif", ".webp", ".ico", ".heic", ".heif", ".avif", ".psd",
  // Vector / fonts (these CAN be text but are usually edited via tooling)
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  // Audio / video
  ".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac",
  ".mp4", ".mov", ".avi", ".mkv", ".webm", ".wmv",
  // Archives
  ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".jar", ".war",
  // Executables / bytecode
  ".exe", ".dll", ".so", ".dylib", ".class", ".o", ".a", ".bin",
  // Databases / binary stores
  ".sqlite", ".sqlite3", ".db", ".mdb",
  // Serialization
  ".pyc", ".pyo",
]);

function isBinaryExtension(p: string): string | null {
  const ext = path.extname(p).toLowerCase();
  return ext && BINARY_EXTENSIONS.has(ext) ? ext : null;
}

export function writeTool(workspace: string): GloveFoldArgs<{
  path: string;
  content: string;
}> {
  return {
    name: "write",
    description:
      "Write content to a file, creating directories as needed. Overwrites if file exists. " +
      "For partial edits, prefer the `edit` tool — write is for new files or full rewrites. " +
      "Refuses binary file extensions (.docx, .pdf, .png, .zip, etc.) because the payload is " +
      "always treated as UTF-8 text; generate those files via a real producer (docx-js, pdfkit, " +
      "image tools, etc.) and let the producer write the bytes.",
    inputSchema: z.object({
      path: z.string().describe("File path (absolute or relative to workspace)"),
      content: z.string().describe("Full file content to write"),
    }),
    requiresPermission: true,
    async do(input) {
      const abs = resolveSafePath(workspace, input.path);
      const binaryExt = isBinaryExtension(abs);
      if (binaryExt) {
        return {
          status: "error",
          data: null,
          message:
            `Refusing to write text content to a ${binaryExt} file (${relPath(workspace, abs)}). ` +
            `The write tool sends the payload as UTF-8 and will produce a corrupt file. ` +
            `Generate the binary with the appropriate tool — e.g. docx-js / python-docx for ` +
            `.docx, pdfkit / pandoc for .pdf, an image library for image formats — and have ` +
            `that producer write the bytes directly. If you truly need to write a UTF-8 file ` +
            `whose name happens to use one of these extensions, rename it first.`,
        };
      }
      const existed = fs.existsSync(abs);
      await fs.promises.mkdir(path.dirname(abs), { recursive: true });
      await fs.promises.writeFile(abs, input.content, "utf-8");
      const lines = input.content.split("\n").length;
      return {
        status: "success",
        data: `${existed ? "Overwrote" : "Created"} ${relPath(workspace, abs)} (${lines} lines, ${input.content.length} bytes)`,
        renderData: {
          path: relPath(workspace, abs),
          bytes: input.content.length,
          lines,
          existed,
        },
      };
    },
  };
}
