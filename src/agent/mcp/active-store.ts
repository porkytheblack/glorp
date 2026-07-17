/**
 * File-backed persistence for a session's active MCP server ids.
 *
 * The file is only written after the user (or the discovery subagent) makes an
 * explicit choice; until then `load()` reports the config defaults, so newly
 * configured servers auto-connect without any stored state.
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface ActiveFile {
  active: string[];
}

export class McpActiveStore {
  constructor(
    private readonly file: string,
    private readonly defaults: () => string[],
  ) {}

  /** Active ids: the persisted set, or the config defaults before first write. */
  load(): string[] {
    const persisted = this.read();
    return persisted ? persisted.active : this.defaults();
  }

  has(id: string): boolean {
    return this.load().includes(id);
  }

  /** Flip one id in or out of the active set. Returns true when it changed. */
  set(id: string, active: boolean): boolean {
    const current = this.load();
    const next = active
      ? current.includes(id) ? current : [...current, id]
      : current.filter((x) => x !== id);
    if (next.length === current.length && next.every((x, i) => x === current[i])) return false;
    this.write({ active: next });
    return true;
  }

  private read(): ActiveFile | null {
    try {
      const raw = fs.readFileSync(this.file, "utf-8");
      const parsed = JSON.parse(raw) as ActiveFile;
      if (!Array.isArray(parsed.active)) return null;
      return { active: parsed.active.filter((x) => typeof x === "string") };
    } catch {
      return null;
    }
  }

  private write(data: ActiveFile): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(data, null, 2));
    } catch {
      // Best effort — an unwritable data dir degrades to config defaults.
    }
  }
}
