/**
 * `createClient({ endpoint, apiKey })` — a typed client over the Garage REST/WS
 * API, grouped into `workspaces`, `sessions`, `models`, `keys`, plus the
 * headline `run()` and `streamSession()`. Pass no opts to use the config from
 * `configure()` / env.
 */

import { request, ping, requestForm, requestBinary } from "./rest.js";
import { runWith, type RunHandle, type RunOptions } from "./run.js";
import { streamSessionWith, type SessionStream } from "./ws.js";
import { resolveConfig, type GlorpConfig } from "./config.js";
import type {
  AgentInfo,
  ApiKeyPublic,
  BridgeEvent,
  CreateSessionInput,
  CreateTaskInput,
  CreateWorkspaceInput,
  FileListResponse,
  NamespaceDto,
  PermissionGrant,
  SessionDto,
  SessionResult,
  TaskDto,
  TaskStatus,
  TaskTypeDto,
  TemplateSummaryDto,
  WorkspaceDto,
} from "./contract.js";

/** The acknowledgement returned by `tasks.create` (the full task via `tasks.get`). */
type TaskCreated = { id: string; type: string; status: TaskStatus; created_at: string };

/** The raw key returned once on creation (with its bound namespace). */
type MintedKey = { id: string; name: string; key: string; keyPrefix: string; scopes: string[]; namespace?: string | null };

/** Encode a workspace-relative path for a URL, keeping `/` separators. */
function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

type Roster = { agents: AgentInfo[]; active_agent_id: string };

function buildClient(cfg: GlorpConfig) {
  const req = <T>(method: string, path: string, body?: unknown) => request<T>(cfg, method, path, body);

  return {
    config: cfg,
    ping: () => ping(cfg),

    workspaces: {
      list: () => req<{ workspaces: WorkspaceDto[]; total: number }>("GET", "/workspaces"),
      /**
       * Register (or template-provision) a workspace. The positional `path`/`name`
       * form is preserved; pass `opts` to provision from a template — `template`
       * names a setup recipe and `params` fills its declared `{param:NAME}` slots.
       * Omitting `path` mints a managed folder under the namespace's workspace root.
       */
      create: (
        path?: string,
        name?: string,
        opts: Pick<CreateWorkspaceInput, "template" | "params"> = {},
      ) => req<WorkspaceDto>("POST", "/workspaces", { path, name, ...opts }),
      get: (id: string) => req<WorkspaceDto & { sessions: SessionDto[] }>("GET", `/workspaces/${id}`),
      delete: (id: string, cascadeSessions = false) =>
        req<void>("DELETE", `/workspaces/${id}${cascadeSessions ? "?sessions=true" : ""}`),
    },

    templates: {
      list: () => req<{ templates: TemplateSummaryDto[] }>("GET", "/templates"),
      get: (name: string) => req<{ template: unknown }>("GET", `/templates/${encodeURIComponent(name)}`),
    },

    sessions: {
      create: (body: CreateSessionInput = {}) => req<SessionDto>("POST", "/sessions", body),
      createInWorkspace: (id: string, body: CreateSessionInput = {}) =>
        req<SessionDto>("POST", `/workspaces/${id}/sessions`, body),
      list: () => req<{ sessions: SessionDto[]; total: number }>("GET", "/sessions"),
      get: (id: string) => req<SessionDto>("GET", `/sessions/${id}`),
      destroy: (id: string, cleanupWorkspace = false) =>
        req<void>("DELETE", `/sessions/${id}${cleanupWorkspace ? "?workspace=true" : ""}`),
      sendMessage: (id: string, text: string) =>
        req<{ accepted: boolean }>("POST", `/sessions/${id}/messages`, { text }),
      /** Blocking variant: runs the turn and returns its final text. */
      sendMessageAndWait: (id: string, text: string) =>
        req<{ text?: string; error?: string }>("POST", `/sessions/${id}/messages`, { text, wait: true }),
      abort: (id: string) => req<{ aborted: boolean }>("POST", `/sessions/${id}/abort`),
      setPermissionMode: (id: string, mode: string) =>
        req<unknown>("POST", `/sessions/${id}/permission-mode`, { mode }),
      setProfile: (id: string, profileId: string) =>
        req<unknown>("POST", `/sessions/${id}/profile`, { profile_id: profileId }),
      history: (id: string) => req<{ turns: unknown[] }>("GET", `/sessions/${id}/history`),
      result: (id: string) => req<SessionResult>("GET", `/sessions/${id}/result`),
      plan: (id: string) => req<{ plan: unknown }>("GET", `/sessions/${id}/plan`),
      tasks: (id: string) => req<{ tasks: unknown[] }>("GET", `/sessions/${id}/tasks`),

      // Multi-agent roster (subagents).
      agents: (id: string) => req<Roster>("GET", `/sessions/${id}/agents`),
      addAgent: (id: string, role: string, label?: string) =>
        req<Roster & { agent_id: string }>("POST", `/sessions/${id}/agents`, { role, label }),
      switchAgent: (id: string, agentId: string) =>
        req<Roster>("POST", `/sessions/${id}/agents/${agentId}`, {}),
      removeAgent: (id: string, agentId: string) =>
        req<Roster>("DELETE", `/sessions/${id}/agents/${agentId}`),

      // Tool-permission grants.
      permissions: (id: string) => req<{ permissions: PermissionGrant[] }>("GET", `/sessions/${id}/permissions`),
      revokePermission: (id: string, key: string) =>
        req<void>("DELETE", `/sessions/${id}/permissions/${encodeURIComponent(key)}`),

      // File exchange — the session's `uploads/` folder (shared with the agent).
      files: (id: string) => req<FileListResponse>("GET", `/sessions/${id}/files`),
      uploadFile: (id: string, file: Blob, name: string) => {
        const form = new FormData();
        form.append("file", file, name);
        return requestForm<FileListResponse>(cfg, `/sessions/${id}/files`, form);
      },
      downloadFile: (id: string, p: string) =>
        requestBinary(cfg, "GET", `/sessions/${id}/files/${encodePath(p)}`),
      deleteFile: (id: string, p: string) =>
        req<void>("DELETE", `/sessions/${id}/files/${encodePath(p)}`),
    },

    /**
     * Tasks — the simple black-box surface. Submit a typed job and poll one
     * object: `create` → `get` until `status` is `completed`/`failed`, answering
     * any `questions` with `answer`, and following up with `message`. A task type
     * is a template name (see `tasks.types`); deliverables land in `result.files`.
     */
    tasks: {
      types: () => req<{ types: TaskTypeDto[] }>("GET", "/tasks/types"),
      create: (input: CreateTaskInput) => req<TaskCreated>("POST", "/tasks", input),
      list: () => req<{ tasks: TaskDto[] }>("GET", "/tasks"),
      get: (id: string) => req<TaskDto>("GET", `/tasks/${id}`),
      /** Continue the task ("now fix X"); the status returns to `working`. */
      message: (id: string, text: string) => req<{ accepted: boolean }>("POST", `/tasks/${id}/messages`, { text }),
      /** Answer a pending question from `task.questions`. */
      answer: (id: string, questionId: string, answer: string | boolean | null) =>
        req<{ resolved: boolean }>("POST", `/tasks/${id}/answers`, { question_id: questionId, answer }),
      uploadFile: (id: string, file: Blob, name: string) => {
        const form = new FormData();
        form.append("file", file, name);
        return requestForm<FileListResponse>(cfg, `/tasks/${id}/files`, form);
      },
      downloadFile: (id: string, p: string) => requestBinary(cfg, "GET", `/tasks/${id}/files/${encodePath(p)}`),
      delete: (id: string) => req<void>("DELETE", `/tasks/${id}`),
    },

    models: {
      providers: () => req<unknown>("GET", "/models/providers"),
      profiles: () => req<unknown>("GET", "/models/profiles"),
      catalog: () => req<unknown>("GET", "/models/catalog"),
    },

    keys: {
      create: (name: string, scopes?: string[]) => req<MintedKey>("POST", "/keys", { name, scopes }),
      list: () => req<ApiKeyPublic[]>("GET", "/keys"),
      revoke: (id: string) => req<{ revoked: boolean }>("DELETE", `/keys/${id}`),
    },

    // Multi-tenancy admin control plane (requires an admin key).
    namespaces: {
      list: () => req<{ namespaces: NamespaceDto[]; total: number }>("GET", "/namespaces"),
      create: (name: string, slug?: string) => req<NamespaceDto>("POST", "/namespaces", { name, slug }),
      get: (id: string) => req<NamespaceDto>("GET", `/namespaces/${encodeURIComponent(id)}`),
      /** Deprovision; `removeData` also wipes the namespace's data subtree + sandboxes. */
      delete: (id: string, removeData = false) =>
        req<{ deleted: boolean; data_removed: boolean }>(
          "DELETE",
          `/namespaces/${encodeURIComponent(id)}${removeData ? "?data=true" : ""}`,
        ),
      /** Mint a key bound to this namespace (raw key returned once; `admin` scope rejected). */
      createKey: (id: string, name: string, scopes?: string[]) =>
        req<MintedKey>("POST", `/namespaces/${encodeURIComponent(id)}/keys`, { name, scopes }),
      listKeys: (id: string) => req<ApiKeyPublic[]>("GET", `/namespaces/${encodeURIComponent(id)}/keys`),
    },

    run: (o: RunOptions): Promise<RunHandle> => runWith(cfg, o),
    streamSession: (id: string, onEvent?: (event: BridgeEvent) => void): SessionStream =>
      streamSessionWith(cfg, id, onEvent),
  };
}

export type GlorpClient = ReturnType<typeof buildClient> & {
  /** A client bound to a namespace — an admin key uses this to act inside `ns`. */
  forNamespace(namespace: string): GlorpClient;
};

/**
 * Create a typed client over the Garage REST/WS API. Pass no opts to use the
 * config from `configure()` / env. `forNamespace(ns)` returns a client bound to
 * a namespace (admin keys use it to act inside a tenant).
 */
export function createClient(opts?: GlorpConfig): GlorpClient {
  const cfg = resolveConfig(opts);
  return { ...buildClient(cfg), forNamespace: (namespace: string) => createClient({ ...cfg, namespace }) };
}
