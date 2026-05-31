/**
 * Persisted registry of first-class workspaces at `<dataDir>/workspaces.json`.
 *
 * A workspace id is derived deterministically from its resolved absolute path,
 * so the same folder always maps to the same id — even across restarts or if
 * the registry file is lost. This makes `ensureForPath` the migration primitive
 * that lazily folds pre-existing sessions (which only know a path) into real
 * workspace entities with zero file rewrites.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { Workspace } from "./types.ts";

/** Stable id for a folder path (resolved first so `.`/`..` normalize). */
export function workspaceIdForPath(p: string): string {
  const resolved = path.resolve(p);
  return "ws_" + createHash("sha256").update(resolved).digest("hex").slice(0, 12);
}

interface WorkspacesFile {
  version: 1;
  workspaces: Record<string, Workspace>;
}

export class WorkspaceStore {
  private readonly filePath: string;
  private data: WorkspacesFile;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, "workspaces.json");
    this.data = this.load();
  }

  private load(): WorkspacesFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as WorkspacesFile;
      if (parsed?.version === 1 && parsed.workspaces && typeof parsed.workspaces === "object") {
        return parsed;
      }
    } catch {
      /* missing or malformed — start fresh */
    }
    return { version: 1, workspaces: {} };
  }

  private flush(): void {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
  }

  list(): Workspace[] {
    return Object.values(this.data.workspaces).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): Workspace | undefined {
    return this.data.workspaces[id];
  }

  getByPath(p: string): Workspace | undefined {
    return this.get(workspaceIdForPath(p));
  }

  /** Create (or return existing) a workspace for a folder path. */
  create(input: { path: string; name?: string }): Workspace {
    const resolved = path.resolve(input.path);
    const id = workspaceIdForPath(resolved);
    const existing = this.data.workspaces[id];
    if (existing) return existing;
    const ws: Workspace = {
      id,
      path: resolved,
      name: input.name?.trim() || path.basename(resolved) || resolved,
      createdAt: new Date().toISOString(),
    };
    this.data.workspaces[id] = ws;
    this.flush();
    return ws;
  }

  /** Get-or-create for a path — folds a bare session path into a workspace. */
  ensureForPath(p: string, name?: string): Workspace {
    return this.getByPath(p) ?? this.create({ path: p, name });
  }

  delete(id: string): boolean {
    if (!this.data.workspaces[id]) return false;
    delete this.data.workspaces[id];
    this.flush();
    return true;
  }
}
