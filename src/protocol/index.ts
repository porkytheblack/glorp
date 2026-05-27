/**
 * Public API surface for the Glorp wire protocol.
 * Clients and server both import from here.
 */

export { PROTOCOL_VERSION, DEFAULT_PORT, WS_CLOSE } from "./envelope.ts";
export type { Envelope, ServerDiscovery, ErrorResponse } from "./envelope.ts";
export type { ClientMessage } from "./commands.ts";
export type {
  ClientHello,
  CmdSendMessage,
  CmdPlanAndBuild,
  CmdAbort,
  CmdResolveSlot,
  CmdRejectSlot,
  CmdResolvePermission,
  CmdSwapProfile,
  CmdClearPermission,
  CmdClearPermissionKey,
  CmdResync,
  CmdStopAgent,
  CmdPromoteAgent,
} from "./commands.ts";
export type { ServerMessage } from "./events.ts";
export type {
  ServerHello,
  PeerJoined,
  PeerLeft,
  WsSessionHydrate,
  WsSessionReset,
  WsTextDelta,
  WsTextClear,
  WsTurn,
  WsTurnUpdate,
  WsToolStarted,
  WsToolFinished,
  WsBusy,
  WsTitle,
  WsStats,
  WsCompaction,
  WsPlan,
  WsTasks,
  WsInbox,
  WsModelLabelChanged,
  WsCommandRejected,
  WsProtocolError,
} from "./events.ts";
export type {
  HealthResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  SessionInfoDto,
  ListSessionsResponse,
  GetSessionResponse,
  ProfileSummary,
  ListProfilesResponse,
} from "./rest.ts";

// Re-export shared data types that protocol consumers need.
export type {
  AgentStats,
  ChatTurn,
  DisplaySlotEvent,
  InboxEntry,
  OrchestratorAgentEvent,
  OrchestratorPhase,
  PlanDocument,
  RunnerAgentStats,
  TaskItem,
  ToolEvent,
  ToolStatus,
} from "../shared/events.ts";
