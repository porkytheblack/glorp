import type {
  Message,
  StoreAdapter,
  Task,
  PermissionStatus,
  InboxItem,
  TokenConsumptionCounter,
} from "glove-core/core";

/**
 * Minimal in-memory StoreAdapter. We can't import `MemoryStore` from
 * the glove-core barrel because that pulls in the Bedrock adapter
 * (which has a broken transitive `@smithy/core` subpath export). This
 * is a tiny equivalent that's just enough for sub-stores and tests.
 */
export class MemoryStore implements StoreAdapter {
  identifier: string;
  private messages: Message[] = [];
  private tokensIn = 0;
  private tokensOut = 0;
  private turnCount = 0;
  private tasks: Task[] = [];
  private permissions = new Map<string, PermissionStatus>();
  private inboxItems: InboxItem[] = [];
  private durableSubStores = new Map<string, MemoryStore>();

  constructor(identifier: string) {
    this.identifier = identifier;
  }

  async getMessages(): Promise<Message[]> {
    return [...this.messages];
  }

  async appendMessages(msgs: Message[]): Promise<void> {
    this.messages.push(...msgs);
  }

  async getTokenCount(): Promise<number> {
    return this.tokensIn + this.tokensOut;
  }

  async addTokens(args: TokenConsumptionCounter): Promise<void> {
    this.tokensIn += args.tokens_in;
    this.tokensOut += args.tokens_out;
  }

  async getTurnCount(): Promise<number> {
    return this.turnCount;
  }

  async incrementTurn(): Promise<void> {
    this.turnCount++;
  }

  async resetCounters(): Promise<void> {
    this.tokensIn = 0;
    this.tokensOut = 0;
    this.turnCount = 0;
  }

  async getTasks(): Promise<Task[]> {
    return [...this.tasks];
  }

  async addTasks(tasks: Task[]): Promise<void> {
    this.tasks.push(...tasks);
  }

  async updateTask(
    taskId: string,
    updates: Partial<Pick<Task, "status" | "content" | "activeForm">>,
  ): Promise<void> {
    const t = this.tasks.find((x) => x.id === taskId);
    if (t) Object.assign(t, updates);
  }

  async getPermission(toolName: string): Promise<PermissionStatus> {
    return this.permissions.get(toolName) ?? "unset";
  }

  async setPermission(toolName: string, status: PermissionStatus): Promise<void> {
    if (status === "unset") this.permissions.delete(toolName);
    else this.permissions.set(toolName, status);
  }

  /** Non-StoreAdapter helper — used by GlorpStore to snapshot all permissions. */
  getAllPermissions(): Record<string, PermissionStatus> {
    return Object.fromEntries(this.permissions);
  }

  async getInboxItems(): Promise<InboxItem[]> {
    return [...this.inboxItems];
  }

  async addInboxItem(item: InboxItem): Promise<void> {
    this.inboxItems.push(item);
  }

  async updateInboxItem(
    itemId: string,
    updates: Partial<Pick<InboxItem, "status" | "response" | "resolved_at">>,
  ): Promise<void> {
    const i = this.inboxItems.find((x) => x.id === itemId);
    if (i) Object.assign(i, updates);
  }

  async getResolvedInboxItems(): Promise<InboxItem[]> {
    return this.inboxItems.filter((i) => i.status === "resolved");
  }

  async createSubAgentStore(namespace: string, durable = false): Promise<StoreAdapter> {
    if (durable) {
      const existing = this.durableSubStores.get(namespace);
      if (existing) return existing;
      const fresh = new MemoryStore(`${this.identifier}__${namespace}`);
      this.durableSubStores.set(namespace, fresh);
      return fresh;
    }
    return new MemoryStore(`${this.identifier}__${namespace}_${Date.now()}`);
  }
}
