/**
 * REST API request/response types for the Glorp server.
 */

export interface HealthResponse {
  status: "ok";
  version: string;
  workspace: string;
  uptime_ms: number;
  active_sessions: number;
}

export interface CreateSessionRequest {
  session_id?: string;
  provider?: string;
  model?: string;
}

export interface CreateSessionResponse {
  session_id: string;
  created: boolean;
  title: string | null;
  workspace: string;
  ws_url: string;
}

export interface SessionInfoDto {
  id: string;
  title: string | null;
  first_user_message: string | null;
  agent_message_count: number;
  user_message_count: number;
  total_messages: number;
  task_count: number;
  pending_inbox_count: number;
  token_count: number;
  turn_count: number;
  last_activity: string;
  workspace: string | null;
  project_id: string | null;
}

export interface ListSessionsResponse {
  sessions: SessionInfoDto[];
  total: number;
}

export interface GetSessionResponse {
  session: SessionInfoDto;
  active: boolean;
  connected_clients: number;
  model_label: string | null;
}

export interface ProfileSummary {
  id: string;
  label: string;
  provider_id: string;
  model: string;
}

export interface ListProfilesResponse {
  profiles: ProfileSummary[];
  active_profile_id: string | null;
}

/** POST /api/v1/sessions/:id/message — synchronous send + collect. */
export interface SendMessageRequest {
  text: string;
  images?: Array<{ data: string; media_type: string }>;
  /** Max time to wait for the agent to finish (default 120 000). */
  timeout_ms?: number;
  /** Auto-approve permission prompts so tool flows don't hang (default true). */
  auto_approve?: boolean;
  /** Stop all running spawned agents after the response (default true). */
  cleanup_agents?: boolean;
}

export interface SubagentEvent {
  name: string;
  phase: "start" | "end";
  status?: "success" | "error";
  message?: string;
}

export interface OrchestratorAgentEvt {
  id: string;
  label: string;
  action: "spawned" | "stopped" | "interrupted";
  role?: string;
  slot?: string;
}

export interface SendMessageResponse {
  text: string | null;
  turns: import("../shared/events.ts").ChatTurn[];
  tools: import("../shared/events.ts").ToolEvent[];
  subagents: SubagentEvent[];
  orchestrator_agents: OrchestratorAgentEvt[];
  error: string | null;
  duration_ms: number;
}
