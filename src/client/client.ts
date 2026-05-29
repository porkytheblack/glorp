/** Glorp WebSocket + REST client SDK. */
import { PROTOCOL_VERSION } from "../protocol/envelope.ts";
import type { ServerMessage, ServerHello } from "../protocol/events.ts";
import type { ClientMessage, ImageAttachment } from "../protocol/commands.ts";
import type {
  CreateSessionRequest, CreateSessionResponse,
  HealthResponse, ListSessionsResponse,
  GetSessionResponse, ListProfilesResponse,
} from "../protocol/rest.ts";
import * as rest from "./rest.ts";
import { buildHeaders } from "./rest.ts";

export type ClientState = "disconnected" | "connecting" | "handshaking" | "connected";
export type ClientListener = (event: ServerMessage) => void;

export interface GlorpClientConfig {
  /** Server URL, e.g. "http://127.0.0.1:3271" */
  url: string;
  /** Client identifier */
  clientId: string;
  /** Human-readable client name */
  clientName?: string;
  /** Bearer token for auth */
  token?: string;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
}

/** Command payload before envelope fields (seq, ts) are attached. */
type CmdPayload = { type: string } & Record<string, unknown>;

const RECONNECT_BASE_MS = 100;
const RECONNECT_MAX_MS = 5000;
const RECONNECT_JITTER = 0.25;

export class GlorpClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<ClientListener>();
  private stateListeners = new Set<(state: ClientState) => void>();
  private _state: ClientState = "disconnected";
  private seq = 0;
  private sessionId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private readonly config: GlorpClientConfig;

  constructor(config: GlorpClientConfig) { this.config = config; }

  get state(): ClientState { return this._state; }
  get currentSessionId(): string | null { return this.sessionId; }

  // ── REST delegates ────────────────────────────────────────
  private get hdrs() { return buildHeaders(this.config.token); }
  health(): Promise<HealthResponse> { return rest.health(this.config.url, this.hdrs); }
  createSession(o?: CreateSessionRequest): Promise<CreateSessionResponse> {
    return rest.createSession(this.config.url, this.hdrs, o);
  }
  listSessions(scope?: string, limit?: number): Promise<ListSessionsResponse> {
    return rest.listSessions(this.config.url, this.hdrs, scope, limit);
  }
  getSession(id: string): Promise<GetSessionResponse> {
    return rest.getSession(this.config.url, this.hdrs, id);
  }
  deleteSession(id: string): Promise<void> {
    return rest.deleteSession(this.config.url, this.hdrs, id);
  }
  listProfiles(): Promise<ListProfilesResponse> {
    return rest.listProfiles(this.config.url, this.hdrs);
  }

  // ── WebSocket lifecycle ───────────────────────────────────
  connect(sessionId: string): void {
    this.sessionId = sessionId;
    this.reconnectAttempt = 0;
    this.doConnect();
  }

  disconnect(): void {
    this.sessionId = null;
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.close(1000);
      this.ws = null;
    }
    this.setState("disconnected");
  }

  subscribe(fn: ClientListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  onStateChange(fn: (state: ClientState) => void): () => void {
    this.stateListeners.add(fn);
    return () => { this.stateListeners.delete(fn); };
  }

  // ── Commands ──────────────────────────────────────────────
  send(text: string, images?: ImageAttachment[]): void { this.sendCmd({ type: "send_message", text, images }); }
  planAndBuild(prompt: string): void { this.sendCmd({ type: "plan_and_build", prompt }); }
  abort(): void { this.sendCmd({ type: "abort" }); }
  resolveSlot(slotId: string, value: unknown): void {
    this.sendCmd({ type: "resolve_slot", slot_id: slotId, value });
  }
  rejectSlot(slotId: string, reason?: string): void {
    this.sendCmd({ type: "reject_slot", slot_id: slotId, reason });
  }
  resolvePermission(slotId: string, allow: boolean): void {
    this.sendCmd({ type: "resolve_permission", slot_id: slotId, allow });
  }
  swapProfile(id: string): void { this.sendCmd({ type: "swap_profile", profile_id: id }); }
  clearPermission(tool: string): void { this.sendCmd({ type: "clear_permission", tool_name: tool }); }
  clearPermissionKey(key: string): void { this.sendCmd({ type: "clear_permission_key", key }); }
  resync(): void { this.sendCmd({ type: "resync" }); }
  stopAgent(id: string, reason?: string): void { this.sendCmd({ type: "stop_agent", agent_id: id, reason }); }
  promoteAgent(id: string): void { this.sendCmd({ type: "promote_agent", agent_id: id }); }
  setPermissionMode(mode: "normal" | "auto" | "bypass"): void { this.sendCmd({ type: "set_permission_mode", mode }); }
  switchAgent(id: string): void { this.sendCmd({ type: "switch_agent", agent_id: id }); }
  addAgent(role: string, label?: string): void { this.sendCmd({ type: "add_agent", role, label }); }
  removeAgent(id: string): void { this.sendCmd({ type: "remove_agent", agent_id: id }); }

  // ── Internal: WebSocket ───────────────────────────────────
  private doConnect(): void {
    if (!this.sessionId) return;
    this.clearReconnectTimer();
    this.setState("connecting");
    const ws = new WebSocket(this.wsUrl(this.sessionId));
    this.ws = ws;

    ws.onopen = () => { this.setState("handshaking"); };
    ws.onmessage = (ev: MessageEvent) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(String(ev.data)) as ServerMessage; }
      catch { return; }
      if (this._state === "handshaking" && msg.type === "server_hello") {
        const hello = msg as ServerHello;
        if (hello.protocol_version !== PROTOCOL_VERSION) {
          ws.close(4006, `version mismatch: client=${PROTOCOL_VERSION} server=${hello.protocol_version}`);
          return;
        }
        this.sendClientHello();
        this.reconnectAttempt = 0;
        this.setState("connected");
      }
      this.emit(msg);
    };
    ws.onerror = () => { /* close event always follows */ };
    ws.onclose = () => {
      this.ws = null;
      this.setState("disconnected");
      if (this.sessionId && this.config.autoReconnect !== false) this.scheduleReconnect();
    };
  }

  private sendClientHello(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const hello: ClientMessage = {
      type: "client_hello", protocol_version: PROTOCOL_VERSION,
      client_id: this.config.clientId, client_name: this.config.clientName,
      seq: ++this.seq, ts: new Date().toISOString(),
    };
    this.ws.send(JSON.stringify(hello));
  }

  private sendCmd(cmd: CmdPayload): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this._state !== "connected") return;
    this.ws.send(JSON.stringify({ ...cmd, seq: ++this.seq, ts: new Date().toISOString() }));
  }

  private emit(msg: ServerMessage): void {
    for (const fn of this.listeners) {
      try { fn(msg); } catch { /* never let listener errors propagate */ }
    }
  }

  private setState(s: ClientState): void {
    if (this._state === s) return;
    this._state = s;
    for (const fn of this.stateListeners) {
      try { fn(s); } catch { /* never let listener errors propagate */ }
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const base = Math.min(RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt), RECONNECT_MAX_MS);
    const jitter = base * RECONNECT_JITTER * (Math.random() * 2 - 1);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => { this.doConnect(); }, Math.max(0, Math.round(base + jitter)));
  }

  private clearReconnectTimer(): void { if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; } }
  private wsUrl(sessionId: string): string {
    const base = this.config.url.replace(/^http/, "ws");
    const id = encodeURIComponent(sessionId);
    const q = this.config.token ? `?token=${encodeURIComponent(this.config.token)}` : "";
    return `${base}/api/v1/sessions/${id}/ws${q}`;
  }
}
