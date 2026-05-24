import type { Message, StoreAdapter, Task, PermissionStatus, InboxItem, TokenConsumptionCounter } from "glove-core/core";
import * as fs from "node:fs";
import * as path from "node:path";
import type { PlanDocument } from "../shared/events.ts";
import type { Snapshot, SnapshotMeta, StoreOptions } from "./store-snapshot.ts";
import { latestTriggerMessage, safeFilePart } from "./store-snapshot.ts";
import { withSessionState } from "./session-state.ts";

export class GlorpStore implements StoreAdapter {
  identifier: string;
  private filePath: string;
  private dataDir: string;
  private metadata: SnapshotMeta;
  private messages: Message[] = [];
  private title: string | null = null;
  private titleUpdatedAt: string | null = null;
  private tokensIn = 0;
  private tokensOut = 0;
  private turnCount = 0;
  private plan: PlanDocument | null = null;
  private tasks: Task[] = [];
  private permissions = new Map<string, PermissionStatus>();
  private inboxItems: InboxItem[] = [];
  private dirty = false;
  private writePromise: Promise<void> | null = null;
  private subStoreSeq = 0;

  constructor(identifier: string, dataDir: string, options: StoreOptions | boolean = {}) {
    const opts = typeof options === "boolean" ? {} : options;
    this.identifier = identifier;
    this.dataDir = dataDir;
    this.filePath = opts.filePath ?? path.join(dataDir, "sessions", `${identifier}.json`);
    this.metadata = opts.metadata ?? { kind: "session", createdAt: new Date().toISOString() };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const snap = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as Partial<Snapshot>;
      this.metadata = snap.metadata ?? this.metadata;
      this.messages = snap.messages ?? [];
      this.title = cleanTitle(snap.title);
      this.titleUpdatedAt = snap.titleUpdatedAt ?? null;
      this.tokensIn = snap.tokensIn ?? 0;
      this.tokensOut = snap.tokensOut ?? 0;
      this.turnCount = snap.turnCount ?? 0;
      this.plan = snap.plan ?? null;
      this.tasks = snap.tasks ?? [];
      this.permissions = new Map(Object.entries(snap.permissions ?? {}));
      this.inboxItems = snap.inboxItems ?? [];
    } catch (err) {
      console.error(`[glorp-store] failed to load ${this.filePath}:`, err);
    }
  }

  private scheduleFlush(): void {
    this.dirty = true;
    if (this.writePromise) return;
    this.writePromise = (async () => {
      try {
        while (this.dirty) {
          this.dirty = false;
          await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
          const tmp = `${this.filePath}.tmp`;
          await fs.promises.writeFile(tmp, JSON.stringify(this.snapshot()), "utf-8");
          await fs.promises.rename(tmp, this.filePath);
          await new Promise((r) => setTimeout(r, 50));
        }
      } catch (err) {
        console.error("[glorp-store] flush failed:", err);
      } finally {
        this.writePromise = null;
      }
    })();
  }

  private snapshot(): Snapshot {
    return {
      metadata: this.metadata,
      messages: this.messages,
      title: this.title,
      titleUpdatedAt: this.titleUpdatedAt,
      tokensIn: this.tokensIn,
      tokensOut: this.tokensOut,
      turnCount: this.turnCount,
      plan: this.plan,
      tasks: this.tasks,
      permissions: Object.fromEntries(this.permissions),
      inboxItems: this.inboxItems,
    };
  }

  async flush(): Promise<void> {
    while (this.writePromise) await this.writePromise;
    if (this.dirty) {
      this.scheduleFlush();
      if (this.writePromise) await this.writePromise;
    }
  }

  async getMessages(): Promise<Message[]> {
    return withSessionState(this.messages, { plan: this.plan, tasks: this.tasks, inboxItems: this.inboxItems });
  }
  async getDisplayMessages(): Promise<Message[]> { return [...this.messages]; }
  async getTitle(): Promise<string | null> { return this.title; }

  async setTitle(title: string | null): Promise<void> {
    this.title = cleanTitle(title);
    this.titleUpdatedAt = this.title ? new Date().toISOString() : null;
    this.scheduleFlush();
  }

  async appendMessages(msgs: Message[]): Promise<void> { this.messages.push(...msgs); this.scheduleFlush(); }
  async getTokenCount(): Promise<number> { return this.tokensIn + this.tokensOut; }
  async getTokenCounts(): Promise<{ in: number; out: number }> {
    return { in: this.tokensIn, out: this.tokensOut };
  }

  async addTokens(args: TokenConsumptionCounter): Promise<void> {
    this.tokensIn += args.tokens_in;
    this.tokensOut += args.tokens_out;
    this.scheduleFlush();
  }

  async getTurnCount(): Promise<number> { return this.turnCount; }
  async incrementTurn(): Promise<void> { this.turnCount++; this.scheduleFlush(); }

  async resetCounters(): Promise<void> {
    this.tokensIn = 0;
    this.tokensOut = 0;
    this.turnCount = 0;
    this.scheduleFlush();
  }

  async getTasks(): Promise<Task[]> { return [...this.tasks]; }
  async getPlan(): Promise<PlanDocument | null> { return this.plan ? { ...this.plan } : null; }

  async updatePlan(input: Pick<PlanDocument, "title" | "body">): Promise<PlanDocument> {
    this.plan = { title: input.title, body: input.body, revision: (this.plan?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
    this.scheduleFlush();
    return { ...this.plan };
  }

  async addTasks(tasks: Task[]): Promise<void> { this.tasks = [...tasks]; this.scheduleFlush(); }

  async updateTask(id: string, updates: Partial<Pick<Task, "status" | "content" | "activeForm">>) {
    const task = this.tasks.find((t) => t.id === id);
    if (task) Object.assign(task, updates);
    this.scheduleFlush();
  }

  async getPermission(toolName: string): Promise<PermissionStatus> { return this.permissions.get(toolName) ?? "unset"; }

  async setPermission(toolName: string, status: PermissionStatus): Promise<void> {
    if (status === "unset") this.permissions.delete(toolName);
    else this.permissions.set(toolName, status);
    this.scheduleFlush();
  }

  async getInboxItems(): Promise<InboxItem[]> { return [...this.inboxItems]; }
  async addInboxItem(item: InboxItem): Promise<void> { this.inboxItems.push(item); this.scheduleFlush(); }

  async updateInboxItem(id: string, updates: Partial<Pick<InboxItem, "status" | "response" | "resolved_at">>) {
    const item = this.inboxItems.find((i) => i.id === id);
    if (item) Object.assign(item, updates);
    this.scheduleFlush();
  }

  async getResolvedInboxItems(): Promise<InboxItem[]> { return this.inboxItems.filter((i) => i.status === "resolved"); }

  async createSubAgentStore(namespace: string, durable = false): Promise<StoreAdapter> {
    const trigger = latestTriggerMessage(this.messages);
    const name = safeFilePart(namespace);
    const runKey = durable ? "durable" : `${Date.now()}_${++this.subStoreSeq}`;
    const filePath = path.join(this.dataDir, "sessions", `${safeFilePart(this.identifier)}.subagents`, name, `${safeFilePart(trigger.id)}_${runKey}.json`);
    return new GlorpStore(`${this.identifier}__${namespace}__${trigger.id}__${runKey}`, this.dataDir, {
      filePath,
      metadata: { kind: "subagent", parentSessionId: this.identifier, namespace, triggerMessageId: trigger.id, triggerMessageIndex: trigger.index, triggerMessageText: trigger.text, durable, createdAt: new Date().toISOString() },
    });
  }
}

function cleanTitle(title: unknown): string | null {
  return typeof title === "string" && title.trim() ? title.replace(/\s+/g, " ").trim() : null;
}
