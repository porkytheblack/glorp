/**
 * Persisted registry of tasks at `<dataDir>/tasks.json` (per namespace).
 *
 * A task is a thin envelope over a worker session — `task id == session id`, so
 * everything dynamic (status, result, questions, files) is projected live from
 * the session on read and is NEVER stored here. This file holds only what the
 * session doesn't know: the task's type, an optional completion callback, and a
 * provisioning error captured when `manager.create` failed before any session
 * could exist (the only way that failure is observable).
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface TaskRecord {
  id: string;
  type: string;
  callback_url?: string;
  created_at: string;
  /** Set when provisioning threw before a session existed → status "failed". */
  provision_error?: string | null;
}

interface TasksFile {
  version: 1;
  tasks: Record<string, TaskRecord>;
}

export class TaskStore {
  private readonly filePath: string;
  private data: TasksFile;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, "tasks.json");
    this.data = this.load();
  }

  private load(): TasksFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as TasksFile;
      if (parsed?.version === 1 && parsed.tasks && typeof parsed.tasks === "object") return parsed;
    } catch {
      /* missing or malformed — start fresh */
    }
    return { version: 1, tasks: {} };
  }

  private flush(): void {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
  }

  /** Newest first. */
  list(): TaskRecord[] {
    return Object.values(this.data.tasks).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  get(id: string): TaskRecord | undefined {
    return this.data.tasks[id];
  }

  create(rec: TaskRecord): TaskRecord {
    this.data.tasks[rec.id] = rec;
    this.flush();
    return rec;
  }

  /** Record a provisioning failure so a sessionless task reads as "failed". */
  setProvisionError(id: string, message: string): void {
    const rec = this.data.tasks[id];
    if (!rec) return;
    rec.provision_error = message;
    this.flush();
  }

  delete(id: string): boolean {
    if (!this.data.tasks[id]) return false;
    delete this.data.tasks[id];
    this.flush();
    return true;
  }
}
