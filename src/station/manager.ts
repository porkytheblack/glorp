/**
 * Multi-session registry. Owns the live StationSession map, provisions
 * workspaces, and bridges in-memory sessions with on-disk snapshots so a
 * session survives a Station restart (lazily rebuilt on first access).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { newSessionId, listSessions, deleteSession } from "../agent/sessions.ts";
import type { PermissionMode } from "../agent/runtime/permission-mode.ts";
import { StationSession } from "./session.ts";
import { snapshotExists, readSnapshotMeta } from "./persistence.ts";
import type { CreateSessionInput, SessionDto } from "./types.ts";

/** Provisions a fresh workspace from a named setup template. */
export interface TemplateProvisioner {
  has(name: string): boolean;
  provision(name: string, params: Record<string, string>, workspace: string): Promise<void>;
}

export interface StationManagerConfig {
  dataDir: string;
  workspaceRoot: string;
  defaultProvider?: string;
  defaultModel?: string;
  permissionMode: PermissionMode;
  templates?: TemplateProvisioner;
}

export class SessionExistsError extends Error {}
export class WorkspaceError extends Error {}

export class SessionManager {
  private sessions = new Map<string, StationSession>();

  constructor(private readonly config: StationManagerConfig) {}

  /** Create a brand-new session. Validates/provisions the workspace up front. */
  async create(input: CreateSessionInput): Promise<StationSession> {
    const id = input.sessionId ?? newSessionId();
    if (this.sessions.has(id) || snapshotExists(this.config.dataDir, id)) {
      throw new SessionExistsError(`Session ${id} already exists`);
    }
    const workspace = this.resolveWorkspace(input, id);
    // Track whether the directory already existed so a failed template doesn't
    // delete a caller-supplied directory that predated this session.
    const preExisted = fs.existsSync(workspace);
    this.validateWorkspace(workspace);
    if (input.template) await this.provisionTemplate(input, workspace, !preExisted);
    return this.register(id, workspace, input);
  }

  /** Run a template's steps in the workspace; tear it down on any failure. */
  private async provisionTemplate(
    input: CreateSessionInput,
    workspace: string,
    createdByUs: boolean,
  ): Promise<void> {
    const provisioner = this.config.templates;
    if (!provisioner || !provisioner.has(input.template!)) {
      throw new WorkspaceError(`Unknown template: ${input.template}`);
    }
    try {
      await provisioner.provision(input.template!, input.params ?? {}, workspace);
    } catch (err) {
      // Only remove a workspace we created — never a pre-existing caller dir.
      if (createdByUs) {
        try {
          fs.rmSync(workspace, { recursive: true, force: true });
        } catch {
          /* best-effort cleanup */
        }
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new WorkspaceError(`Template provisioning failed: ${msg}`);
    }
  }

  private register(id: string, workspace: string, input: CreateSessionInput): StationSession {
    const session = new StationSession({
      id,
      workspace,
      dataDir: this.config.dataDir,
      provider: input.provider ?? this.config.defaultProvider,
      model: input.model ?? this.config.defaultModel,
      profileId: input.profileId,
      permissionMode: input.permissionMode ?? this.config.permissionMode,
      customCredential: input.credentials ?? null,
    });
    this.sessions.set(id, session);
    return session;
  }

  /** Live session by id, or undefined. Does not touch disk. */
  get(id: string): StationSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * Live session, rehydrating from an on-disk snapshot if necessary. The
   * returned session is registered but its GlorpHandle is only built on first
   * `ensureBuilt()` call.
   */
  getOrRehydrate(id: string): StationSession | undefined {
    const live = this.sessions.get(id);
    if (live) return live;
    const meta = readSnapshotMeta(this.config.dataDir, id);
    if (!meta) return undefined;
    const workspace = meta.workspace ?? path.join(this.config.workspaceRoot, id);
    return this.register(id, workspace, {});
  }

  /** All sessions: live ones plus dormant on-disk snapshots not yet loaded. */
  async list(): Promise<SessionDto[]> {
    const dtos = new Map<string, SessionDto>();
    for (const session of this.sessions.values()) {
      if (session.state === "destroyed") continue;
      dtos.set(session.id, session.toDto());
    }
    const onDisk = await listSessions(this.config.dataDir, { kind: "all" });
    for (const info of onDisk) {
      if (dtos.has(info.id)) continue;
      dtos.set(info.id, dormantDto(info));
    }
    return [...dtos.values()].sort((a, b) => b.last_activity.localeCompare(a.last_activity));
  }

  /**
   * Permanently destroy a session: unload it, delete its on-disk snapshot
   * (so it can't resurrect via rehydration), and optionally remove its
   * workspace directory. Returns false if nothing existed to destroy.
   */
  async destroy(id: string, opts: { workspace?: boolean } = {}): Promise<boolean> {
    const session = this.sessions.get(id);
    const onDisk = snapshotExists(this.config.dataDir, id);
    if (!session && !onDisk) return false;

    const workspace = session?.workspace ?? readSnapshotMeta(this.config.dataDir, id)?.workspace ?? null;
    if (session) {
      this.sessions.delete(id);
      await session.destroy();
    }
    await deleteSession(this.config.dataDir, id);
    if (opts.workspace && workspace) {
      try {
        fs.rmSync(workspace, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
    return true;
  }

  /** Flush every live session's store (used on graceful shutdown). */
  async shutdownAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      await session.flush();
      await session.destroy();
    }
    this.sessions.clear();
  }

  get liveCount(): number {
    let n = 0;
    for (const s of this.sessions.values()) if (s.state !== "destroyed") n++;
    return n;
  }

  private resolveWorkspace(input: CreateSessionInput, id: string): string {
    if (input.workspace) return path.resolve(input.workspace);
    return path.join(this.config.workspaceRoot, id);
  }

  /** Fail fast if the workspace can't be created or written to. */
  private validateWorkspace(workspace: string): void {
    try {
      fs.mkdirSync(workspace, { recursive: true });
      fs.accessSync(workspace, fs.constants.W_OK);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new WorkspaceError(`Workspace not usable: ${workspace} (${msg})`);
    }
  }
}

function dormantDto(info: Awaited<ReturnType<typeof listSessions>>[number]): SessionDto {
  return {
    id: info.id,
    state: "idle",
    workspace: info.workspace ?? "",
    title: info.title,
    model_label: null,
    permission_mode: "normal",
    created_at: info.lastActivity.toISOString(),
    last_activity: info.lastActivity.toISOString(),
    connected_clients: 0,
    busy: false,
    loaded: false,
    tokens_in: 0,
    tokens_out: 0,
    turn_count: info.turnCount,
    error: null,
    custom_credentials: null,
  };
}
