/** One workspace, one isolated Bridge, one lazily built GlorpHandle. */

import { Bridge } from "../shared/bridge.ts";
import { buildGlorp } from "../agent/glorp.ts";
import { GlorpStore } from "../agent/store.ts";
import type { GlorpHandle, BuildGlorpOptions } from "../agent/glorp-types.ts";
import { EventStream } from "./event-stream.ts";
import { SessionCredentialsStore } from "./credentials.ts";
import { SessionStats } from "./session-stats.ts";
import { buildSessionDto } from "./session-dto.ts";
import type { StationSessionInit } from "./session-init.ts";
import type { SessionLifecycle, SessionDto, SessionCredential } from "./types.ts";

export class StationSession {
  readonly id: string;
  readonly workspace: string;
  readonly workspaceId: string | null;
  readonly bridge = new Bridge();
  readonly stream: EventStream;
  readonly stats = new SessionStats();
  state: SessionLifecycle = "provisioning";
  error: string | null = null;
  readonly createdAt = Date.now();
  lastActivity = Date.now();
  customCredential: SessionCredential | null;

  private readonly init: StationSessionInit;
  private handle: GlorpHandle | null = null;
  private buildPromise: Promise<GlorpHandle> | null = null;
  private readStore: GlorpStore | null = null;
  private credStore: SessionCredentialsStore | null = null;

  constructor(init: StationSessionInit) {
    this.init = init;
    this.id = init.id;
    this.workspace = init.workspace;
    this.workspaceId = init.workspaceId ?? null;
    this.customCredential = init.customCredential ?? null;
    this.stream = new EventStream(init.id);
    this.bridge.subscribe((ev) => this.onEvent(ev));
  }

  /** The permission mode requested at creation (DTO fallback before build). */
  get defaultPermissionMode() {
    return this.init.permissionMode;
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
      this.credStore = new SessionCredentialsStore(this.init.dataDir, {
        custom: this.customCredential,
        profileId: this.init.profileId,
      });
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

  /** Remove the custom key, reverting to Station defaults. */
  async clearCredential(): Promise<void> {
    const credentials = this.credentials();
    const profileId = credentials.stationDefaultProfileId();
    if (this.handle && !profileId) {
      throw new Error("Cannot clear session credential without a Station default profile");
    }
    if (this.handle && profileId) await this.handle.swapProfile(profileId);
    this.customCredential = null;
    credentials.clearCustom();
  }

  /** Send a user message, building the agent if needed. Captures fatal errors. */
  async send(text: string, images?: Array<{ data: string; media_type: string }>): Promise<void> {
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
  }

  /** Move the session to the unrecoverable error state without killing Station. */
  fail(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.state = "error";
    this.error = message;
    this.bridge.emit({ type: "error", message });
  }

  /** Attach a freshly built (or existing) handle's hydrate snapshot to clients. */
  async hydrate(): Promise<void> {
    const handle = await this.ensureBuilt();
    await handle.hydrateUi();
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

  async destroy(): Promise<void> {
    this.state = "destroyed";
    if (this.handle) {
      try {
        await this.handle.shutdown();
      } catch (err) {
        console.error(`[station] session ${this.id} shutdown error:`, err);
      }
    }
    this.handle = null;
    this.buildPromise = null;
    this.readStore = null;
  }

  /** Flush the underlying store so state survives a Station restart. */
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
    if (ev.type === "busy" && this.state !== "destroyed" && this.state !== "error") {
      this.state = ev.busy ? "busy" : "idle";
    }
    this.stream.broadcast(ev);
  }
}
