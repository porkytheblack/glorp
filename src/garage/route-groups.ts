/**
 * Per-namespace route groups. Each namespace bundle owns its own set of these,
 * built against that namespace's SessionManager + CredentialsStore, so a request
 * resolved to namespace N only ever touches N's data. The truly global groups
 * (`keys`, `templates`) are NOT here — they live once on the router.
 */

import type { SessionManager } from "./manager.ts";
import type { GarageConfig } from "./config.ts";
import type { CredentialsStore } from "../agent/credentials.ts";
import type { UploadsSync } from "./storage/types.ts";
import type { TaskStore } from "./task-store.ts";
import type { TemplateSource } from "./templates/source.ts";
import { taskRoutes } from "./routes/tasks.ts";
import { sessionRoutes } from "./routes/sessions.ts";
import { workspaceRoutes } from "./routes/workspaces.ts";
import { mcpRoutes } from "./routes/mcp.ts";
import { stateRoutes } from "./routes/state.ts";
import { controlRoutes } from "./routes/control.ts";
import { modelRoutes } from "./routes/models.ts";
import { ModelCatalog } from "../agent/model-catalog.ts";
import { credentialRoutes } from "./routes/credentials.ts";
import { fileRoutes } from "./routes/files.ts";

export interface RouteGroups {
  sessions: ReturnType<typeof sessionRoutes>;
  workspaces: ReturnType<typeof workspaceRoutes>;
  mcp: ReturnType<typeof mcpRoutes>;
  state: ReturnType<typeof stateRoutes>;
  control: ReturnType<typeof controlRoutes>;
  models: ReturnType<typeof modelRoutes>;
  creds: ReturnType<typeof credentialRoutes>;
  files: ReturnType<typeof fileRoutes>;
  /** Caller-supplied task INPUT files — the worker's read-side, in `inputs/`. */
  inputs: ReturnType<typeof fileRoutes>;
  tasks: ReturnType<typeof taskRoutes>;
}

/** Build the per-namespace route groups for one bundle's manager + credentials. */
export function buildRouteGroups(
  manager: SessionManager,
  config: GarageConfig,
  credentials: CredentialsStore,
  nsId: string,
  tasks: TaskStore,
  templates: TemplateSource,
  uploadsSync?: UploadsSync,
): RouteGroups {
  return {
    sessions: sessionRoutes(manager, config),
    workspaces: workspaceRoutes(manager, config),
    mcp: mcpRoutes(manager),
    state: stateRoutes(manager),
    control: controlRoutes(manager),
    models: modelRoutes(credentials, new ModelCatalog(config.dataDir)),
    creds: credentialRoutes(manager),
    files: fileRoutes(manager, config, nsId, uploadsSync),
    // Inputs live alongside uploads but in their own folder; kept local (no R2
    // mirror) — they are caller-provided job inputs, not deliverables.
    inputs: fileRoutes(manager, config, nsId, undefined, "inputs"),
    tasks: taskRoutes(manager, config, tasks, templates),
  };
}
