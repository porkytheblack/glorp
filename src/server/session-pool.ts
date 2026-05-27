/**
 * Manages the active agent session.
 *
 * The global Bridge singleton is shared between the GlorpHandle (which emits
 * events into it) and the server (which relays those events to WS clients).
 * Only one session is active at a time — creating a new session shuts down
 * the previous one. Multiple WS clients can connect to the same session.
 */

import { buildGlorp } from "../agent/glorp.ts";
import type { GlorpHandle, BuildGlorpOptions } from "../agent/glorp-types.ts";
import { newSessionId } from "../agent/sessions.ts";
import { getBridge } from "../shared/bridge.ts";
import type { Bridge } from "../shared/bridge.ts";

export interface ActiveSession {
  id: string;
  handle: GlorpHandle;
  bridge: Bridge;
  clients: Set<string>;
  createdAt: number;
}

export class SessionPool {
  private sessions = new Map<string, ActiveSession>();

  constructor(
    private workspace: string,
    private dataDir: string,
    private defaultProvider?: string,
    private defaultModel?: string,
  ) {}

  /**
   * Get an existing session or create a new one. When a new session is
   * created, any previous session is shut down first (single-session model).
   */
  async getOrCreate(
    sessionId?: string,
    opts?: { provider?: string; model?: string },
  ): Promise<{ session: ActiveSession; created: boolean }> {
    const id = sessionId ?? newSessionId();

    const existing = this.sessions.get(id);
    if (existing) {
      return { session: existing, created: false };
    }

    // Shut down any prior session — only one active at a time.
    await this.shutdownAll();

    const bridge = getBridge();
    const buildOpts: BuildGlorpOptions = {
      workspace: this.workspace,
      sessionId: id,
      dataDir: this.dataDir,
      provider: opts?.provider ?? this.defaultProvider,
      model: opts?.model ?? this.defaultModel,
    };

    const handle = await buildGlorp(buildOpts);
    const session: ActiveSession = {
      id,
      handle,
      bridge,
      clients: new Set(),
      createdAt: Date.now(),
    };

    this.sessions.set(id, session);
    return { session, created: true };
  }

  /** Get an active session by id. */
  get(id: string): ActiveSession | undefined {
    return this.sessions.get(id);
  }

  /** Number of active sessions (0 or 1 in the single-session model). */
  get size(): number {
    return this.sessions.size;
  }

  /** Shut down a specific session and remove it from the pool. */
  async shutdown(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    try {
      await session.handle.shutdown();
    } catch (err) {
      console.error(`[session-pool] error shutting down session ${id}:`, err);
    }
  }

  /** Shut down all active sessions. */
  async shutdownAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    for (const id of ids) {
      await this.shutdown(id);
    }
  }
}
