import { MemoryStore } from "./memory-store-shim.ts";
import type {
  Message,
  StoreAdapter,
  Task,
  PermissionStatus,
  InboxItem,
  TokenConsumptionCounter,
} from "glove-core/core";
import * as fs from "node:fs";
import * as path from "node:path";

interface Snapshot {
  messages: Message[];
  tokensIn: number;
  tokensOut: number;
  turnCount: number;
  tasks: Task[];
  permissions: Record<string, PermissionStatus>;
  inboxItems: InboxItem[];
}

/**
 * File-backed StoreAdapter. Wraps an in-memory MemoryStore but persists
 * after every mutation to a JSON file under `~/.glorp/sessions/<id>.json`.
 * Survives restarts; reloads on construction. No native deps — perfect for
 * the single-binary build.
 *
 * Sub-stores (for subagents) are kept in-process only by default; pass
 * `persistSubAgents: true` if you want them on disk too.
 */
export class GlorpStore implements StoreAdapter {
  identifier: string;
  private inner: MemoryStore;
  private filePath: string;
  private dirty = false;
  private writePromise: Promise<void> | null = null;
  private persistSubAgents: boolean;

  constructor(identifier: string, dataDir: string, persistSubAgents = false) {
    this.identifier = identifier;
    this.inner = new MemoryStore(identifier);
    this.persistSubAgents = persistSubAgents;
    this.filePath = path.join(dataDir, "sessions", `${identifier}.json`);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const snap = JSON.parse(raw) as Snapshot;
      // Replay into the inner MemoryStore so we get its semantics for free.
      void this.inner.appendMessages(snap.messages ?? []);
      void this.inner.addTokens({
        tokens_in: snap.tokensIn ?? 0,
        tokens_out: snap.tokensOut ?? 0,
      });
      for (let i = 0; i < (snap.turnCount ?? 0); i++) {
        void this.inner.incrementTurn();
      }
      if (snap.tasks?.length) void this.inner.addTasks(snap.tasks);
      for (const [tool, status] of Object.entries(snap.permissions ?? {})) {
        void this.inner.setPermission(tool, status as PermissionStatus);
      }
      for (const item of snap.inboxItems ?? []) {
        void this.inner.addInboxItem(item);
      }
    } catch (err) {
      console.error(`[glorp-store] failed to load ${this.filePath}:`, err);
    }
  }

  private scheduleFlush(): void {
    this.dirty = true;
    if (this.writePromise) return;
    this.writePromise = (async () => {
      // Coalesce a tick of writes.
      await new Promise((r) => setTimeout(r, 50));
      this.writePromise = null;
      if (!this.dirty) return;
      this.dirty = false;
      try {
        const snap: Snapshot = {
          messages: await this.inner.getMessages(),
          tokensIn: 0,
          tokensOut: 0,
          turnCount: await this.inner.getTurnCount(),
          tasks: (await this.inner.getTasks()) ?? [],
          permissions: {},
          inboxItems: (await this.inner.getInboxItems()) ?? [],
        };
        // MemoryStore exposes only the combined token count, not in/out.
        // We snapshot the total and replay it as `tokens_in` on load — fine
        // for our use (recovery, not analytics).
        snap.tokensIn = await this.inner.getTokenCount();
        const tmp = `${this.filePath}.tmp`;
        await fs.promises.writeFile(tmp, JSON.stringify(snap), "utf-8");
        await fs.promises.rename(tmp, this.filePath);
      } catch (err) {
        console.error("[glorp-store] flush failed:", err);
      }
    })();
  }

  async getMessages(): Promise<Message[]> {
    return this.inner.getMessages();
  }

  async appendMessages(msgs: Message[]): Promise<void> {
    await this.inner.appendMessages(msgs);
    this.scheduleFlush();
  }

  async getTokenCount(): Promise<number> {
    return this.inner.getTokenCount();
  }

  async addTokens(args: TokenConsumptionCounter): Promise<void> {
    await this.inner.addTokens(args);
    this.scheduleFlush();
  }

  async getTurnCount(): Promise<number> {
    return this.inner.getTurnCount();
  }

  async incrementTurn(): Promise<void> {
    await this.inner.incrementTurn();
    this.scheduleFlush();
  }

  async resetCounters(): Promise<void> {
    await this.inner.resetCounters();
    this.scheduleFlush();
  }

  async getTasks(): Promise<Task[]> {
    return this.inner.getTasks();
  }

  async addTasks(tasks: Task[]): Promise<void> {
    await this.inner.addTasks(tasks);
    this.scheduleFlush();
  }

  async updateTask(
    taskId: string,
    updates: Partial<Pick<Task, "status" | "content" | "activeForm">>,
  ): Promise<void> {
    await this.inner.updateTask(taskId, updates);
    this.scheduleFlush();
  }

  async getPermission(toolName: string): Promise<PermissionStatus> {
    return this.inner.getPermission(toolName);
  }

  async setPermission(toolName: string, status: PermissionStatus): Promise<void> {
    await this.inner.setPermission(toolName, status);
    this.scheduleFlush();
  }

  async getInboxItems(): Promise<InboxItem[]> {
    return this.inner.getInboxItems();
  }

  async addInboxItem(item: InboxItem): Promise<void> {
    await this.inner.addInboxItem(item);
    this.scheduleFlush();
  }

  async updateInboxItem(
    itemId: string,
    updates: Partial<Pick<InboxItem, "status" | "response" | "resolved_at">>,
  ): Promise<void> {
    await this.inner.updateInboxItem(itemId, updates);
    this.scheduleFlush();
  }

  async getResolvedInboxItems(): Promise<InboxItem[]> {
    return this.inner.getResolvedInboxItems();
  }

  async createSubAgentStore(namespace: string, durable?: boolean): Promise<StoreAdapter> {
    if (this.persistSubAgents) {
      const dataDir = path.dirname(path.dirname(this.filePath));
      return new GlorpStore(`${this.identifier}__${namespace}`, dataDir, false);
    }
    return this.inner.createSubAgentStore(namespace, durable);
  }
}
