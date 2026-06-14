/** One workspace, one isolated Bridge, one lazily built GlorpHandle. */

import * as fs from "node:fs";
import * as path from "node:path";
import { Bridge } from "../shared/bridge.ts";
import { buildGlorp } from "../agent/glorp.ts";
import { GlorpStore } from "../agent/store.ts";
import { CredentialsStore } from "../agent/credentials.ts";
import { resolveSessionPaths } from "../agent/session-paths.ts";
import { classifyModelError } from "../shared/error-classify.ts";
import type { GlorpHandle, BuildGlorpOptions } from "../agent/glorp-types.ts";
import type { DisplaySlotEvent } from "../shared/events.ts";
import { EventStream } from "./event-stream.ts";
import { SessionCredentialsStore } from "./credentials.ts";
import { SessionStats } from "./session-stats.ts";
import { buildSessionDto } from "./session-dto.ts";
import { getActiveUploadsSync, type UploadsScopeWithData } from "./storage/r2-sync.ts";
import type { GarageSessionInit } from "./session-init.ts";
import type { SessionLifecycle, SessionDto, SessionCredential } from "./types.ts";

/** Per-session Garage preferences that must survive rebuilds and restarts —
 * e.g. the model profile the user picked mid-session. */
interface SessionPrefs {
  profileId?: string;
}

export class GarageSession {
  readonly id: string;
  readonly workspace: string;
  readonly workspaceId: string | null;
  readonly bridge = new Bridge();
  readonly stream: EventStream;
  readonly stats = new SessionStats();
  // Born idle: by registration time the workspace exists. "provisioning" is
  // reserved for the template-provisioning window, not "not yet loaded" —
  // dormant sessions are idle and rehydratable, and showing them as
  // provisioning forever made the fleet read as perpetually stuck.
  state: SessionLifecycle = "idle";
  error: string | null = null;
  readonly createdAt = Date.now();
  lastActivity = Date.now();
  customCredential: SessionCredential | null;

  private readonly init: GarageSessionInit;
  private handle: GlorpHandle | null = null;
  private buildPromise: Promise<GlorpHandle> | null = null;
  private readStore: GlorpStore | null = null;
  private credStore: SessionCredentialsStore | null = null;
  private readonly prefsPath: string;
  /** Recent classified errors, replayed on hydrate — an error that fired with
   * no client connected would otherwise be unobservable in the conversation. */
  private recentErrors: Array<Extract<import("../shared/events.ts").BridgeEvent, { type: "error" }>> = [];
  /** FIFO of user turns: a message that arrives while a task runs WAITS for it
   * instead of aborting it (the old behavior silently killed in-flight work). */
  private sendChain: Promise<void> = Promise.resolve();
  queuedMessages = 0;

  constructor(init: GarageSessionInit) {
    this.init = init;
    this.id = init.id;
    this.workspace = init.workspace;
    this.workspaceId = init.workspaceId ?? null;
    this.customCredential = init.customCredential ?? null;
    this.stream = new EventStream(init.id);
    this.bridge.subscribe((ev) => this.onEvent(ev));
    this.prefsPath = path.join(path.dirname(resolveSessionPaths(init.dataDir, init.id).rosterFile), "garage.json");
    // A profile picked mid-session in a previous process wins over the
    // creation-time default.
    const prefs = this.readPrefs();
    if (prefs.profileId) this.init.profileId = prefs.profileId;
  }

  private readPrefs(): SessionPrefs {
    try {
      return JSON.parse(fs.readFileSync(this.prefsPath, "utf-8")) as SessionPrefs;
    } catch {
      return {};
    }
  }

  private writePrefs(patch: SessionPrefs): void {
    try {
      fs.mkdirSync(path.dirname(this.prefsPath), { recursive: true });
      fs.writeFileSync(this.prefsPath, JSON.stringify({ ...this.readPrefs(), ...patch }, null, 2));
    } catch {
      /* prefs are best-effort — never fail a session over them */
    }
  }

  /** Swap the model profile AND persist the choice so rebuilds/restarts keep it. */
  async swapProfile(profileId: string): Promise<void> {
    const handle = await this.ensureBuilt();
    await handle.swapProfile(profileId);
    this.init.profileId = profileId;
    this.writePrefs({ profileId });
  }

  /** The permission mode requested at creation (DTO fallback before build). */
  get defaultPermissionMode() {
    return this.init.permissionMode;
  }

  /** The namespace this session lives in (scopes remote-storage keys). */
  get nsId(): string {
    return this.init.nsId ?? "default";
  }

  /** The session's data dir — where its snapshot and uploads manifest live. */
  get dataDir(): string {
    return this.init.dataDir;
  }

  /** True once the underlying GlorpHandle is live in memory. */
  get loaded(): boolean {
    return this.handle !== null;
  }

  /** Build the GlorpHandle on demand (idempotent, dedupes concurrent calls). */
  async ensureBuilt(): Promise<GlorpHandle> {
    if (this.handle) return this.handle;
    if (!this.buildPromise) {
      // Drop the cached promise on failure so a later call (e.g. after the
      // caller supplies a working API key) can retry instead of being wedged
      // on a permanently-rejected promise.
      this.buildPromise = this.build().catch((err) => {
        this.buildPromise = null;
        throw err;
      });
    }
    return this.buildPromise;
  }

  /** The session's credentials store (lazily created, retained for swaps). */
  private credentials(): SessionCredentialsStore {
    if (!this.credStore) {
      const base = this.init.fallbackDataDir ? new CredentialsStore(this.init.fallbackDataDir) : null;
      this.credStore = new SessionCredentialsStore(
        this.init.dataDir,
        { custom: this.customCredential, profileId: this.init.profileId },
        base,
      );
    }
    return this.credStore;
  }

  private async build(): Promise<GlorpHandle> {
    const credentials = this.credentials();
    const opts: BuildGlorpOptions = {
      workspace: this.workspace,
      sessionId: this.id,
      dataDir: this.init.dataDir,
      bridge: this.bridge,
      credentials,
      permissionMode: this.init.permissionMode,
      task: this.init.task ?? undefined,
      // Garage sessions run in a disposable per-session container — the sandbox
      // is the boundary, so the shell guard skips workspace-path confinement.
      sandboxed: true,
    };
    // When a custom key or an explicit profile drives the session, the
    // credentials store's active profile resolves it — passing provider/model
    // here would take pickModel's CLI branch and ignore the overlaid key.
    if (!this.customCredential && !this.init.profileId) {
      opts.provider = this.init.provider;
      opts.model = this.init.model;
    }
    const handle = await buildGlorp(opts);
    this.handle = handle;
    this.stats.title = handle.title;
    if (this.state === "provisioning") this.state = "idle";
    return handle;
  }

  /** Set/replace the session's custom API key, swapping the live model if built. */
  async setCredential(cred: SessionCredential): Promise<void> {
    this.customCredential = cred;
    const profileId = this.credentials().setCustom(cred);
    if (this.handle) await this.handle.swapProfile(profileId);
  }

  /** Remove the custom key, reverting to Garage defaults. */
  async clearCredential(): Promise<void> {
    const credentials = this.credentials();
    const profileId = credentials.garageDefaultProfileId();
    if (this.handle && !profileId) {
      throw new Error("Cannot clear session credential without a Garage default profile");
    }
    if (this.handle && profileId) await this.handle.swapProfile(profileId);
    this.customCredential = null;
    credentials.clearCustom();
  }

  /**
   * Send a user message, building the agent if needed. Messages queue FIFO
   * per session: one that arrives mid-task WAITS for the running turn instead
   * of aborting it. (The handle's own send() aborts in-flight work — correct
   * for the TUI's REPL semantics, fatal for an orchestrator where "continue"
   * used to silently kill hours of progress.)
   */
  async send(text: string, images?: Array<{ data: string; media_type: string }>): Promise<void> {
    if (this.state === "destroyed") return;
    this.queuedMessages++;
    if (this.queuedMessages > 1) this.bridge.emit({ type: "queue_depth", depth: this.queuedMessages - 1 });
    const turn = async (): Promise<void> => {
      this.queuedMessages--;
      this.bridge.emit({ type: "queue_depth", depth: Math.max(0, this.queuedMessages - 1) });
      if (this.state === "destroyed") return;
      let handle: GlorpHandle;
      try {
        handle = await this.ensureBuilt();
      } catch (err) {
        this.fail(err);
        return;
      }
      try {
        await handle.send(text, images);
      } catch (err) {
        this.fail(err);
      }
    };
    const next = this.sendChain.then(turn, turn);
    this.sendChain = next;
    await next;
  }

  /** Move the session to the unrecoverable error state without killing Garage. */
  fail(err: unknown): void {
    const raw = err instanceof Error ? err.message : String(err);
    const c = classifyModelError(err);
    // The same root failure can surface through several paths (send chain,
    // hydrate-on-connect) — one error event per distinct failure is enough.
    if (this.state === "error" && this.error === c.title) return;
    this.state = "error";
    this.error = c.title;
    this.bridge.emit({
      type: "error",
      message: c.title,
      detail: raw,
      kind: c.kind,
      hint: c.hint,
      ...(c.retryAfterSec ? { retryAfterSec: c.retryAfterSec } : {}),
    });
  }

  /** Attach a freshly built (or existing) handle's hydrate snapshot to clients. */
  async hydrate(): Promise<void> {
    const handle = await this.ensureBuilt();
    await handle.hydrateUi();
    // Replay errors after the snapshot (straight to the stream — not the
    // bridge — so they don't re-enter the buffer). Clients reset their
    // transcript on hydrate, so each cycle yields exactly one copy.
    for (const e of this.recentErrors) this.stream.broadcast(e);
  }

  /** Read-through to the live handle, or null when not yet built. */
  current(): GlorpHandle | null {
    return this.handle;
  }

  /** Read-only state queries without building the model adapter. */
  peekStore(): GlorpStore {
    if (this.handle) return this.handle.store;
    if (!this.readStore) this.readStore = new GlorpStore(this.id, this.init.dataDir);
    return this.readStore;
  }

  /** Open display slots (pending questions/prompts), or [] when not built. */
  openSlots(): DisplaySlotEvent[] {
    return this.handle ? this.handle.openSlots() : [];
  }

  async destroy(): Promise<void> {
    const wasBusy = this.stats.busy;
    this.state = "destroyed";
    if (this.handle) {
      try {
        // A running turn won't stop itself when the handle shuts down, so abort
        // it first: destroy must never silently leave a busy agent alive holding
        // the slot. Harmless no-op when the session is already idle.
        if (wasBusy) this.handle.abort();
        await this.handle.shutdown();
      } catch (err) {
        console.error(`[garage] session ${this.id} shutdown error:`, err);
      }
    }
    this.handle = null;
    this.buildPromise = null;
    this.readStore = null;
  }

  /** Flush the underlying store so state survives a Garage restart. */
  async flush(): Promise<void> {
    if (this.handle) await this.handle.store.flush().catch(() => {});
  }

  toDto(): SessionDto {
    return buildSessionDto(this);
  }

  /** Mirror the session's own event bus to its clients and track live stats. */
  private onEvent(ev: Parameters<Parameters<Bridge["subscribe"]>[0]>[0]): void {
    this.lastActivity = Date.now();
    this.stats.apply(ev);
    if (ev.type === "error") {
      this.recentErrors.push(ev);
      if (this.recentErrors.length > 10) this.recentErrors.shift();
    }
    if (ev.type === "busy" && this.state !== "destroyed" && this.state !== "error") {
      this.state = ev.busy ? "busy" : "idle";
      // A turn just finished — mirror anything the agent dropped in uploads/ to
      // the bucket (debounced, fire-and-forget; no-op when unconfigured).
      if (!ev.busy) this.pushUploads();
    }
    this.stream.broadcast(ev);
  }

  /**
   * Schedule a remote-mirror push of this session's uploads folder. Uses the
   * module-level engine (see r2-sync.ts) because the session is built by the
   * frozen manager and can't be handed the engine through its init. Best-effort
   * and silent: a missing folder or unconfigured mirror is simply skipped.
   */
  private pushUploads(): void {
    const active = getActiveUploadsSync();
    if (!active) return;
    const root = path.join(this.workspace, active.uploadsDir);
    if (!fs.existsSync(root)) return;
    const scope: UploadsScopeWithData = { nsId: this.nsId, sessionId: this.id, root, dataDir: this.init.dataDir };
    active.engine.scheduleSync(scope);
  }
}
