import type { PermissionMode } from "../agent/runtime/permission-mode.ts";
import type { SessionCredential } from "./types.ts";

export interface StationSessionInit {
  id: string;
  workspace: string;
  dataDir: string;
  provider?: string;
  model?: string;
  profileId?: string;
  permissionMode: PermissionMode;
  customCredential?: SessionCredential | null;
}
