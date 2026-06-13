import type { PermissionMode } from "../agent/runtime/permission-mode.ts";
import type { SessionCredential } from "./types.ts";

export interface GarageSessionInit {
  id: string;
  workspace: string;
  /** Id of the first-class workspace this session belongs to. */
  workspaceId?: string | null;
  /** Namespace the session lives in (scopes remote-storage keys). Default "default". */
  nsId?: string;
  dataDir: string;
  /**
   * Garage data dir used as a credentials fallback when this session lives in a
   * tenant namespace. Unset (or equal to `dataDir`) for the default namespace.
   */
  fallbackDataDir?: string;
  provider?: string;
  model?: string;
  profileId?: string;
  permissionMode: PermissionMode;
  customCredential?: SessionCredential | null;
  /** Present when this session is the worker for a Garage task. */
  task?: { type: string } | null;
}
