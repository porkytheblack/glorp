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
import { WorkspaceStore } from "./workspace-store.ts";
import type { CreateSessionInput, CreateWorkspaceInput, SessionDto, Workspace, WorkspaceDto } from "./types.ts";

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
  /** First-class workspace registry. Defaults to one rooted at `dataDir`. */
  workspaces?: WorkspaceStore;
}

export class SessionExistsError extends Error {}
export class WorkspaceError extends Error {}

export class SessionManager {
  private sessions = new Map<string, StationSession>();
  private readonly workspaces: WorkspaceStore;

  constructor(private readonly config: StationManagerConfig) {
    this.workspaces = config.workspaces ?? new WorkspaceStore(config.dataDir);
  }

  /** Create a brand-new session. Validates/provisions the workspace up front. */
  async create(input: CreateSessionInput): Promise<StationSession> {
    const id = input.sessionId ?? newSessionId();
    if (this.sessions.has(id) || snapshotExists(this.config.dataDir, id)) {
      throw new SessionExistsError(`Session ${id} already exists`);
    }
    const workspace = this.resolveWorkspacePath(input, id);
    // Track whether the directory already existed so a failed template doesn't
    // delete a caller-supplied directory that predated this session.
    const preExisted = fs.existsSync(workspace);
    this.validateWorkspace(workspace);
    if (input.template) await this.provisionTemplate(input, workspace, !preExisted);
    // Associate the session with a first-class workspace (get-or-create by path).
    const ws = input.workspaceId ? this.workspaces.get(input.workspaceId)! : this.workspaces.ensureForPath(workspace);
    return this.register(id, workspace, ws.id, input);
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

  private register(
    id: string,
    workspace: string,
    workspaceId: string | null,
    input: CreateSessionInput,
  ): StationSession {
    const session = new StationSession({
      id,
      workspace,
      workspaceId,
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
    const workspaceId = this.workspaces.ensureForPath(workspace).id;
    return this.register(id, workspace, workspaceId, {});
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
      // Lazily fold the dormant session's path into a first-class workspace.
      const workspaceId = info.workspace ? this.workspaces.ensureForPath(info.workspace).id : null;
      dtos.set(info.id, dormantDto(info, workspaceId));
    }
    return [...dtos.values()].sort((a, b) => b.last_activity.localeCompare(a.last_activity));
  }

  // --- Workspaces ---------------------------------------------------------

  /** All workspaces with their live+dormant session counts. */
  async listWorkspaces(): Promise<WorkspaceDto[]> {
    const sessions = await this.list();
    const counts = new Map<string, number>();
    for (const s of sessions) {
      if (s.workspace_id) counts.set(s.workspace_id, (counts.get(s.workspace_id) ?? 0) + 1);
    }
    return this.workspaces.list().map((w) => workspaceDto(w, counts.get(w.id) ?? 0));
  }

  getWorkspace(id: string): Workspace | undefined {
    return this.workspaces.get(id);
  }

  /** Register a workspace for an existing/creatable folder path. */
  createWorkspace(input: CreateWorkspaceInput): WorkspaceDto {
    if (!input.path) throw new WorkspaceError("A workspace 'path' is required");
    const resolved = path.resolve(input.path);
    this.validateWorkspace(resolved);
    return workspaceDto(this.workspaces.create({ path: resolved, name: input.name }), 0);
  }

  async sessionsForWorkspace(id: string): Promise<SessionDto[]> {
    const all = await this.list();
    return all.filter((s) => s.workspace_id === id);
  }

  /** Remove a workspace; `sessions` cascades destroy of its sessions. */
  async deleteWorkspace(id: string, opts: { sessions?: boolean } = {}): Promise<boolean> {
    if (!this.workspaces.get(id)) return false;
    if (opts.sessions) {
      for (const s of await this.sessionsForWorkspace(id)) await this.destroy(s.id);
    }
    return this.workspaces.delete(id);
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
    if (opts.workspace && workspace) await this.maybeRemoveWorkspaceDir(id, workspace);
    return true;
  }

  /**
   * Remove a session's workspace directory on destroy — but ONLY when it's safe:
   * the directory must live under `workspaceRoot` (a Station-provisioned sandbox,
   * never a caller-supplied project folder) AND no other live/dormant session may
   * still reference it. This stops a single session destroy from wiping a shared
   * or user-owned workspace. Otherwise the folder is kept and a warning is logged.
   */
  private async maybeRemoveWorkspaceDir(sessionId: string, workspace: string): Promise<void> {
    const dir = path.resolve(workspace);
    const root = path.resolve(this.config.workspaceRoot);
    if (!dir.startsWith(root + path.sep)) {
      console.warn(`[glorp-station] keeping workspace ${dir}: not a Station-managed directory.`);
      return;
    }
    const others = (await this.list()).filter((s) => s.id !== sessionId && path.resolve(s.workspace) === dir);
    if (others.length > 0) {
      console.warn(`[glorp-station] keeping workspace ${dir}: ${others.length} other session(s) still use it.`);
      return;
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
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

  private resolveWorkspacePath(input: CreateSessionInput, id: string): string {
    if (input.workspaceId) {
      const ws = this.workspaces.get(input.workspaceId);
      if (!ws) throw new WorkspaceError(`Unknown workspace: ${input.workspaceId}`);
      return ws.path;
    }
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

function workspaceDto(w: Workspace, sessionCount: number): WorkspaceDto {
  return { id: w.id, name: w.name, path: w.path, created_at: w.createdAt, session_count: sessionCount };
}

function dormantDto(
  info: Awaited<ReturnType<typeof listSessions>>[number],
  workspaceId: string | null,
): SessionDto {
  return {
    id: info.id,
    state: "idle",
    workspace: info.workspace ?? "",
    workspace_id: workspaceId,
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
