export type FleetKind = "research" | "edit-fanout" | "shell-fanout";
export type FleetResultStatus = "resolved" | "error";

export interface FleetSignalInput {
  itemId: string;
  tag: string;
  payload: string;
  workspace: string;
  dataDir?: string;
  name?: string;
  provider?: string;
  model?: string;
  profileId?: string;
}

export interface FleetSignalResult {
  response: string;
  status: FleetResultStatus;
}
