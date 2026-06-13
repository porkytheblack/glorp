/**
 * Multi-session registry. Owns the live GarageSession map, provisions
 * workspaces, and bridges in-memory sessions with on-disk snapshots so a
 * session survives a Garage restart (lazily rebuilt on first access).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { newSessionId, listSessions, deleteSession } from "../agent/sessions.ts";
import type { PermissionMode } from "../agent/runtime/permission-mode.ts";
import { GarageSession } from "./session.ts";
import { snapshotExists, readSnapshotMeta } from "./persistence.ts";
import { WorkspaceStore } from "./workspace-store.ts";
import type { CreateSessionInput, CreateWorkspaceInput, SessionDto, Workspace, WorkspaceDto } from "./types.ts";

/** Provisions a fresh workspace from a named setup template. */
export interface TemplateProvisioner {
  /** May be async — registry-backed sources check the network. */
  has(name: string): boolean | Promise<boolean>;
  provision(name: string, params: Record<string, string>, workspace: string): Promise<void>;
}

export interface GarageManagerConfig {
  dataDir: string;
  workspaceRoot: string;
  /** Namespace this manager serves (scopes remote-storage keys). Default "default". */
  nsId?: string;
  defaultProvider?: string;
  defaultModel?: string;
  permissionMode: PermissionMode;
  templates?: TemplateProvisioner;
  /** First-class workspace registry. Defaults to one rooted at `dataDir`. */
  workspaces?: WorkspaceStore;
  /**
   * Garage data dir used as a credentials fallback when this manager serves a
   * tenant namespace (so a namespace without its own keys uses the garage's).
   * Unset (or equal to `dataDir`) for the default namespace.
   */
  fallbackDataDir?: string;
  /**
   * Confine every session's workspace to `workspaceRoot`. Set for tenant
   * namespaces so a tenant can never point a session at another namespace's
   * subtree (or anywhere on the host). The default namespace leaves this off so
   * the operator keeps the power-user ability to attach an arbitrary host repo.
   */
  confineWorkspaces?: boolean;
}

export class SessionExistsError extends Error {}
export class WorkspaceError extends Error {}

/**
 * A session id must be a safe single path segment — it is interpolated into
 * workspace and snapshot paths, so `.`/`..`/slashes would escape the namespace
 * subtree. Mirrors the namespace-id boundary in namespace-store.ts.
 */
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,120}$/;

export class SessionManager {
  private sessions = new Map<string, GarageSession>();
  private readonly workspaces: WorkspaceStore;

  constructor(private readonly config: GarageManagerConfig) {
    this.workspaces = config.workspaces ?? new WorkspaceStore(config.dataDir);
  }

  /** Create a brand-new session. Validates/provisions the workspace up front. */
  async create(input: CreateSessionInput): Promise<GarageSession> {
    const id = input.sessionId ?? newSessionId();
    if (input.sessionId !== undefined && !SESSION_ID_RE.test(input.sessionId)) {
      throw new WorkspaceError(`Invalid sessionId: must match ${SESSION_ID_RE}`);
    }
    if (this.sessions.has(id) || snapshotExists(this.config.dataDir, id)) {
      throw new SessionExistsError(`Session ${id} already exists`);
    }
    const workspace = this.resolveWorkspacePath(input, id);
    // Track whether the directory already existed so a failed template doesn't
    // delete a caller-supplied directory that predated this session.
    const preExisted = fs.existsSync(workspace);
    this.validateWorkspace(workspace);
    if (input.template) await this.provisionInto(input.template, input.params ?? {}, workspace, !preExisted);
    // Associate the session with a first-class workspace (get-or-create by path).
    const ws = input.workspaceId ? this.workspaces.get(input.workspaceId)! : this.workspaces.ensureForPath(workspace);
    return this.register(id, workspace, ws.id, input);
  }

  /** Run a template in the workspace; tear the workspace down on any failure. */
  private async provisionInto(
    template: string,
    params: Record<string, string>,
    workspace: string,
    createdByUs: boolean,
  ): Promise<void> {
    const provisioner = this.config.templates;
    if (!provisioner || !(await provisioner.has(template))) {
      throw new WorkspaceError(`Unknown template: ${template}`);
    }
    try {
      await provisioner.provision(template, params, workspace);
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
  ): GarageSession {
    const session = new GarageSession({
      id,
      workspace,
      workspaceId,
      nsId: this.config.nsId,
      dataDir: this.config.dataDir,
      fallbackDataDir: this.config.fallbackDataDir,
      provider: input.provider ?? this.config.defaultProvider,
      model: input.model ?? this.config.defaultModel,
      profileId: input.profileId,
      permissionMode: input.permissionMode ?? this.config.permissionMode,
      customCredential: input.credentials ?? null,
      task: input.task ?? null,
    });
    this.sessions.set(id, session);
    return session;
  }

  /** Live session by id, or undefined. Does not touch disk. */
  get(id: string): GarageSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * Live session, rehydrating from an on-disk snapshot if necessary. The
   * returned session is registered but its GlorpHandle is only built on first
   * `ensureBuilt()` call.
   */
  getOrRehydrate(id: string): GarageSession | undefined {
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

  /**
   * Register a workspace. With a `path`, adopts that folder; without one, mints
   * a fresh managed folder under `workspaceRoot` (used by API-driven provisioning
   * where the caller doesn't know — or shouldn't pick — a host path). With a
   * `template`, provisions the folder from it before registering — this is the
   * path that makes template-built workspaces available to MCP-driven creation.
   */
  async createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceDto> {
    const resolved = input.path
      ? path.resolve(input.path)
      : path.join(this.config.workspaceRoot, this.mintSlug(input.name));
    this.assertConfined(resolved);
    const preExisted = fs.existsSync(resolved);
    this.validateWorkspace(resolved);
    if (input.template) await this.provisionInto(input.template, input.params ?? {}, resolved, !preExisted);
    return workspaceDto(this.workspaces.create({ path: resolved, name: input.name }), 0);
  }

  /** A unique, filesystem-safe folder segment for a minted workspace. */
  private mintSlug(name?: string): string {
    const base = (name ?? "mcp").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
    return `${base || "mcp"}-${randomUUID().slice(0, 8)}`;
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
   * the directory must live under `workspaceRoot` (a Garage-provisioned sandbox,
   * never a caller-supplied project folder) AND no other live/dormant session may
   * still reference it. This stops a single session destroy from wiping a shared
   * or user-owned workspace. Otherwise the folder is kept and a warning is logged.
   */
  private async maybeRemoveWorkspaceDir(sessionId: string, workspace: string): Promise<void> {
    const dir = path.resolve(workspace);
    const root = path.resolve(this.config.workspaceRoot);
    if (!dir.startsWith(root + path.sep)) {
      console.warn(`[glorp-garage] keeping workspace ${dir}: not a Garage-managed directory.`);
      return;
    }
    const others = (await this.list()).filter((s) => s.id !== sessionId && path.resolve(s.workspace) === dir);
    if (others.length > 0) {
      console.warn(`[glorp-garage] keeping workspace ${dir}: ${others.length} other session(s) still use it.`);
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

  /**
   * Reclaim idle live sessions to free the agent host they hold. A session is
   * reaped only when its handle is built (`loaded`), it isn't busy, no WebSocket
   * client is watching it, and it has been idle for at least `idleMs`. Reaping
   * flushes + shuts the handle but KEEPS the on-disk snapshot, so the session
   * goes dormant and rehydrates transparently on the next access — no data loss,
   * no resurrection surprise. Returns the ids it reclaimed. `idleMs <= 0` is a
   * no-op (GC disabled). This is the engine behind the garage idle-session GC.
   */
  async reapIdle(idleMs: number, now: number = Date.now()): Promise<string[]> {
    if (idleMs <= 0) return [];
    const reaped: string[] = [];
    for (const session of [...this.sessions.values()]) {
      if (!session.loaded) continue; // dormant — holds no agent host
      if (session.stats.busy || session.state === "destroyed") continue;
      if (session.stream.size > 0) continue; // a client is actively watching
      if (session.openSlots().length > 0) continue; // a task/prompt is awaiting an answer (G2)
      if (now - session.lastActivity < idleMs) continue;
      await session.flush().catch(() => {});
      try {
        await session.destroy(); // shuts the handle; snapshot stays on disk
        this.sessions.delete(session.id);
        reaped.push(session.id);
      } catch (err) {
        // Keep it registered so a later sweep (or shutdown) can retry teardown,
        // and don't let one failure abort reaping the rest of this pass.
        console.warn(`[glorp-garage] gc: failed to unload session ${session.id}:`, err);
      }
    }
    return reaped;
  }

  private resolveWorkspacePath(input: CreateSessionInput, id: string): string {
    const resolved = this.resolveWorkspaceCandidate(input, id);
    this.assertConfined(resolved);
    return resolved;
  }

  private resolveWorkspaceCandidate(input: CreateSessionInput, id: string): string {
    if (input.workspaceId) {
      const ws = this.workspaces.get(input.workspaceId);
      if (!ws) throw new WorkspaceError(`Unknown workspace: ${input.workspaceId}`);
      return ws.path;
    }
    if (input.workspace) return path.resolve(input.workspace);
    return path.join(this.config.workspaceRoot, id);
  }

  /**
   * In a tenant namespace, every workspace must live strictly under (or at) the
   * namespace's `workspaceRoot`. Stops a tenant from pointing a session at
   * another namespace's subtree or anywhere else on the host. No-op for the
   * default namespace (confineWorkspaces off).
   */
  private assertConfined(dir: string): void {
    if (!this.config.confineWorkspaces) return;
    const root = path.resolve(this.config.workspaceRoot);
    const p = path.resolve(dir);
    if (p !== root && !p.startsWith(root + path.sep)) {
      throw new WorkspaceError(`Workspace must be within the namespace root`);
    }
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
