/**
 * Reads setup templates from `<templatesDir>/*.json`. Each file is one
 * template named after its filename (without extension), unless it declares
 * its own `name`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Template } from "./types.ts";
import { normalizeTemplate } from "./normalize.ts";

export class TemplateStore {
  constructor(private readonly dir: string) {}

  list(): Template[] {
    if (!fs.existsSync(this.dir)) return [];
    const out: Template[] = [];
    for (const file of fs.readdirSync(this.dir)) {
      if (!file.endsWith(".json")) continue;
      const t = this.read(path.join(this.dir, file), file.replace(/\.json$/, ""));
      if (t) out.push(t);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): Template | undefined {
    const t = this.read(path.join(this.dir, `${name}.json`), name);
    if (t) return t;
    // Fall back to a file whose declared name differs from its filename.
    return this.list().find((x) => x.name === name);
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  private read(file: string, fallbackName: string): Template | undefined {
    try {
      return normalizeTemplate(JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<Template>, fallbackName);
    } catch {
      return undefined;
    }
  }
}
