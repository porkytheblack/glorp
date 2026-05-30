/** Builds the public, secret-free REST view of a session. */

import type { StationSession } from "./session.ts";
import type { SessionDto } from "./types.ts";

export function buildSessionDto(s: StationSession): SessionDto {
  const handle = s.current();
  return {
    id: s.id,
    state: s.state,
    workspace: s.workspace,
    title: s.stats.title,
    model_label: handle?.modelLabel ?? null,
    permission_mode: handle?.permissionMode ?? s.defaultPermissionMode,
    created_at: new Date(s.createdAt).toISOString(),
    last_activity: new Date(s.lastActivity).toISOString(),
    connected_clients: s.stream.size,
    busy: s.stats.busy,
    loaded: s.loaded,
    tokens_in: s.stats.tokensIn,
    tokens_out: s.stats.tokensOut,
    turn_count: s.stats.turnCount,
    error: s.error,
    custom_credentials: s.customCredential
      ? { provider: s.customCredential.provider, last4: last4(s.customCredential.apiKey) }
      : null,
  };
}

function last4(key: string): string {
  return key.length <= 4 ? key : key.slice(-4);
}
