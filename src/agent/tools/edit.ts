import { z } from "zod";
import * as fs from "node:fs";
import type { GloveFoldArgs } from "glove-core";
import { resolveSafePath, relPath, isFile } from "./fs-shared.ts";

export function editTool(workspace: string): GloveFoldArgs<{
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}> {
  return {
    name: "edit",
    description:
      "Replace an exact string in a file. `old_string` must match exactly (whitespace included) and must be unique unless `replace_all: true`. " +
      "Always `read` the file first so you know the exact content. " +
      "Returns a small diff summary.",
    requiresPermission: true,
    inputSchema: z.object({
      path: z.string().describe("File path to edit"),
      old_string: z.string().describe("Exact text to replace"),
      new_string: z.string().describe("Replacement text"),
      replace_all: z
        .boolean()
        .optional()
        .describe("Replace every occurrence (default: false, requires uniqueness)"),
    }),
    async do(input) {
      const abs = resolveSafePath(workspace, input.path);
      if (!(await isFile(abs))) {
        return {
          status: "error",
          data: null,
          message: `Not a file: ${relPath(workspace, abs)}. Use \`write\` to create a new file.`,
        };
      }
      const original = await fs.promises.readFile(abs, "utf-8");
      if (input.old_string === input.new_string) {
        return {
          status: "error",
          data: null,
          message: "old_string and new_string are identical — no edit to perform.",
        };
      }
      const occurrences = original.split(input.old_string).length - 1;
      if (occurrences === 0) {
        return {
          status: "error",
          data: null,
          message:
            "old_string not found in file. Read the file again and copy the exact text (including whitespace and surrounding context).",
        };
      }
      if (occurrences > 1 && !input.replace_all) {
        return {
          status: "error",
          data: null,
          message: `old_string appears ${occurrences} times. Either expand it to be unique or set replace_all: true.`,
        };
      }
      // Split/join (never `String.prototype.replace`) — passing a literal
      // new_string to `replace` would treat `$&`, `$1`, `$\``, `$$` etc. as
      // backreferences and silently corrupt template literals, regex code,
      // and shell snippets in the replacement text.
      const next = original.split(input.old_string).join(input.new_string);
      await fs.promises.writeFile(abs, next, "utf-8");
      const removed = input.old_string.split("\n").length;
      const added = input.new_string.split("\n").length;
      return {
        status: "success",
        data: `Edited ${relPath(workspace, abs)} — ${occurrences} replacement${
          occurrences === 1 ? "" : "s"
        } (-${removed} +${added} lines per match)`,
        renderData: {
          path: relPath(workspace, abs),
          occurrences,
          old: input.old_string,
          new: input.new_string,
          replaceAll: !!input.replace_all,
        },
      };
    },
  };
}
