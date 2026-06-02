import type { PermissionMode } from "../agent/runtime/permission-mode.ts";
import type { SessionCredential } from "./types.ts";

export interface StationSessionInit {
  id: string;
  workspace: string;
  /** Id of the first-class workspace this session belongs to. */
  workspaceId?: string | null;
  dataDir: string;
  /**
   * Station data dir used as a credentials fallback when this session lives in a
   * tenant namespace. Unset (or equal to `dataDir`) for the default namespace.
   */
  fallbackDataDir?: string;
  provider?: string;
  model?: string;
  profileId?: string;
  permissionMode: PermissionMode;
  customCredential?: SessionCredential | null;
}
