import { api } from "./api";
import type { SessionDto } from "./types";

export interface LaunchOpts {
  prompt?: string;
  workspaceId?: string;
  workspace?: string;
  profileId?: string;
  permissionMode?: string;
}

/** Create a session (optionally with a first message) and return its id. */
export async function launchSession(opts: LaunchOpts): Promise<string> {
  const body: Record<string, unknown> = {};
  if (opts.workspaceId) body.workspaceId = opts.workspaceId;
  else if (opts.workspace?.trim()) body.workspace = opts.workspace.trim();
  if (opts.profileId) body.profileId = opts.profileId;
  if (opts.permissionMode) body.permissionMode = opts.permissionMode;

  const session = await api<SessionDto>("/sessions", { method: "POST", body });
  if (opts.prompt?.trim()) {
    await api(`/sessions/${session.id}/messages`, { method: "POST", body: { text: opts.prompt.trim() } });
  }
  return session.id;
}
