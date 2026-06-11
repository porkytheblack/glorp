import type { Message, StoreAdapter, Task, PermissionStatus, InboxItem, TokenConsumptionCounter } from "glove-core/core";
import * as fs from "node:fs";
import * as path from "node:path";
import type { PlanDocument } from "../shared/events.ts";
import type { OriginalRequest, Snapshot, SnapshotMeta, StoreOptions } from "./store-snapshot.ts";
import { firstUserRequest, isPleasantry, latestTriggerMessage, safeFilePart } from "./store-snapshot.ts";
import { withSessionState } from "./session-state.ts";
import { canonicalPermissionKey } from "./permission-key.ts";
import { deriveProjectId } from "./workspace-id.ts";
import { sessionMigrator, CURRENT_SESSION_VERSION } from "./migrations/session-store.ts";
import { repairToolFlow, toolFlowIsClean } from "./runtime/tool-flow-repair.ts";
import type { VerificationTracker } from "./runtime/verification-tracker.ts";

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
  private originalRequest: OriginalRequest | null = null;
  private verification: VerificationTracker | null = null;
  private dirty = false;
  private writePromise: Promise<void> | null = null;
  private subStoreSeq = 0;

  constructor(identifier: string, dataDir: string, options: StoreOptions | boolean = {}) {
    const opts = typeof options === "boolean" ? {} : options;
    this.identifier = identifier;
    this.dataDir = dataDir;
    this.filePath = opts.filePath ?? path.join(dataDir, "sessions", `${identifier}.json`);
    this.metadata = opts.metadata ?? buildDefaultMetadata(opts);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.loadFromDisk();
    // If this is a fresh session for an explicit workspace, stamp the
    // metadata now so the first persisted snapshot is already scoped.
    if (opts.workspace && !this.metadata.workspace) {
      this.metadata = {
        ...this.metadata,
        workspace: opts.workspace,
        projectId: opts.projectId ?? deriveProjectId(opts.workspace),
      };
      this.dirty = true;
    }
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as unknown;
      // Run schema migrations before consuming any fields. A document from a
      // newer build is left untouched; one we upgraded is marked dirty so the
      // migrated shape is persisted on the next flush.
      const result = sessionMigrator.migrate(parsed);
      if (result.fromFuture) {
        console.error(`[migrations:session] ${this.filePath} written by a newer glorp (v${result.fromVersion} > v${sessionMigrator.currentVersion}); leaving as-is`);
      }
      const snap = result.data as Partial<Snapshot>;
      if (result.applied.length > 0) this.dirty = true;
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
      this.originalRequest = snap.originalRequest ?? null;
      // Back-fill for sessions persisted before originalRequest existed.
      // Only works if compaction hasn't already wiped the first user message.
      if (!this.originalRequest) {
        const first = firstUserRequest(this.messages);
        if (first) {
          this.originalRequest = {
            id: first.id,
            text: first.text,
            capturedAt: new Date().toISOString(),
          };
          this.dirty = true;
        }
      }
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
      version: CURRENT_SESSION_VERSION,
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
      originalRequest: this.originalRequest,
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
    return withSessionState(this.messages, {
      plan: this.plan,
      tasks: this.tasks,
      inboxItems: this.inboxItems,
      originalRequest: this.originalRequest,
      verification: this.verification?.status() ?? null,
    });
  }
  async getDisplayMessages(): Promise<Message[]> { return [...this.messages]; }

  /** Repair dangling tool calls / out-of-position results (e.g. after an
   * aborted turn) so the next replay satisfies strict providers. No-op when
   * the history is already clean. */
  repairToolFlow(): void {
    if (toolFlowIsClean(this.messages)) return;
    this.messages = repairToolFlow(this.messages);
    this.scheduleFlush();
  }
  async getTitle(): Promise<string | null> { return this.title; }
  getOriginalRequest(): OriginalRequest | null { return this.originalRequest; }
  getMetadata(): SnapshotMeta { return { ...this.metadata }; }
  getWorkspace(): string | undefined { return this.metadata.workspace; }
  getProjectId(): string | undefined { return this.metadata.projectId; }
  setVerificationTracker(tracker: VerificationTracker | null): void { this.verification = tracker; }
  getVerificationTracker(): VerificationTracker | null { return this.verification; }

  async setTitle(title: string | null): Promise<void> {
    this.title = cleanTitle(title);
    this.titleUpdatedAt = this.title ? new Date().toISOString() : null;
    this.scheduleFlush();
  }

  async appendMessages(msgs: Message[]): Promise<void> {
    this.messages.push(...msgs);
    // Capture the anchor — and UPGRADE it when the locked-in text was just a
    // pleasantry ("hey") and a substantive ask arrives later, so compaction
    // anchors the real request.
    if (!this.originalRequest || isPleasantry(this.originalRequest.text)) {
      const first = firstUserRequest(msgs);
      if (first && (!this.originalRequest || !isPleasantry(first.text))) {
        this.originalRequest = {
          id: first.id,
          text: first.text,
          capturedAt: new Date().toISOString(),
        };
      }
    }
    this.scheduleFlush();
  }
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

  async getPermission(toolName: string, input?: unknown): Promise<PermissionStatus> {
    return this.permissions.get(canonicalPermissionKey(toolName, input)) ?? "unset";
  }

  async setPermission(toolName: string, status: PermissionStatus, input?: unknown): Promise<void> {
    const key = canonicalPermissionKey(toolName, input);
    if (status === "unset") this.permissions.delete(key);
    else this.permissions.set(key, status);
    this.scheduleFlush();
  }

  /** Snapshot of every persisted permission entry (canonical key → status).
   *  Used by the Ctrl+P overlay to render the live grant list. */
  listPermissions(): Array<{ key: string; status: PermissionStatus }> {
    return [...this.permissions.entries()]
      .map(([key, status]) => ({ key, status }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  /** Clear a single permission by its canonical key. The next call that
   *  produces the same canonical key will re-prompt. */
  async clearPermissionKey(key: string): Promise<void> {
    if (this.permissions.delete(key)) this.scheduleFlush();
  }

  /** Sweep every persisted grant whose canonical key belongs to a given
   *  tool. Used by the legacy `clearPermission(toolName)` API so revoking
   *  "bash" wipes all of `bash:git`, `bash:rm`, `bash:*`, etc. in one go. */
  async clearAllPermissionsFor(toolName: string): Promise<void> {
    const prefix = `${toolName}:`;
    let touched = false;
    for (const key of [...this.permissions.keys()]) {
      if (key === toolName || key.startsWith(prefix)) {
        this.permissions.delete(key);
        touched = true;
      }
    }
    if (touched) this.scheduleFlush();
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
    // Locate sub-agent runs next to this store: under the session folder
    // (folder layout, file "session.json") or as a sibling "<id>.subagents"
    // dir (legacy flat layout). Derived from the actual file so it works for
    // the main store, conversational agents, and nested sub-agents alike.
    const dir = path.dirname(this.filePath);
    const fileBase = path.basename(this.filePath, ".json");
    const subBase = fileBase === "session"
      ? path.join(dir, "subagents")
      : path.join(dir, `${fileBase}.subagents`);
    const filePath = path.join(subBase, name, `${safeFilePart(trigger.id)}_${runKey}.json`);
    return new GlorpStore(`${this.identifier}__${namespace}__${trigger.id}__${runKey}`, this.dataDir, {
      filePath,
      metadata: { kind: "subagent", parentSessionId: this.identifier, namespace, triggerMessageId: trigger.id, triggerMessageIndex: trigger.index, triggerMessageText: trigger.text, durable, createdAt: new Date().toISOString() },
    });
  }
}

function cleanTitle(title: unknown): string | null {
  return typeof title === "string" && title.trim() ? title.replace(/\s+/g, " ").trim() : null;
}

function buildDefaultMetadata(opts: StoreOptions): SnapshotMeta {
  const meta: SnapshotMeta = { kind: "session", createdAt: new Date().toISOString() };
  if (opts.workspace) {
    meta.workspace = opts.workspace;
    meta.projectId = opts.projectId ?? deriveProjectId(opts.workspace);
  }
  return meta;
}
