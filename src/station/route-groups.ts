/**
 * Per-namespace route groups. Each namespace bundle owns its own set of these,
 * built against that namespace's SessionManager + CredentialsStore, so a request
 * resolved to namespace N only ever touches N's data. The truly global groups
 * (`keys`, `templates`) are NOT here — they live once on the router.
 */

import type { SessionManager } from "./manager.ts";
import type { StationConfig } from "./config.ts";
import type { CredentialsStore } from "../agent/credentials.ts";
import { sessionRoutes } from "./routes/sessions.ts";
import { workspaceRoutes } from "./routes/workspaces.ts";
import { stateRoutes } from "./routes/state.ts";
import { controlRoutes } from "./routes/control.ts";
import { modelRoutes } from "./routes/models.ts";
import { credentialRoutes } from "./routes/credentials.ts";
import { fileRoutes } from "./routes/files.ts";

export interface RouteGroups {
  sessions: ReturnType<typeof sessionRoutes>;
  workspaces: ReturnType<typeof workspaceRoutes>;
  state: ReturnType<typeof stateRoutes>;
  control: ReturnType<typeof controlRoutes>;
  models: ReturnType<typeof modelRoutes>;
  creds: ReturnType<typeof credentialRoutes>;
  files: ReturnType<typeof fileRoutes>;
}

/** Build the per-namespace route groups for one bundle's manager + credentials. */
export function buildRouteGroups(
  manager: SessionManager,
  config: StationConfig,
  credentials: CredentialsStore,
): RouteGroups {
  return {
    sessions: sessionRoutes(manager, config),
    workspaces: workspaceRoutes(manager, config),
    state: stateRoutes(manager),
    control: controlRoutes(manager),
    models: modelRoutes(credentials),
    creds: credentialRoutes(manager),
    files: fileRoutes(manager, config),
  };
}
