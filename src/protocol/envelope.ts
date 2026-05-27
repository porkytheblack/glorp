/**
 * Wire protocol envelope — shared shape for every WebSocket message.
 * Both server→client events and client→server commands extend this.
 */

export const PROTOCOL_VERSION = 1;

/** Default server port. Mnemonic: "g-l-o-r-p" phone keypad. */
export const DEFAULT_PORT = 3271;

export interface Envelope {
  /** Message type discriminator. */
  type: string;
  /** Monotonically increasing sequence number, scoped to the connection. */
  seq: number;
  /** ISO-8601 timestamp when the message was created. */
  ts: string;
}

/** Server discovery file written to `<dataDir>/server.json`. */
export interface ServerDiscovery {
  port: number;
  pid: number;
  workspace: string;
  version: string;
  startedAt: string;
}

/** Standard REST error shape. */
export interface ErrorResponse {
  error: string;
  message: string;
}

/** WebSocket close codes. */
export const WS_CLOSE = {
  NORMAL: 1000,
  SERVER_SHUTDOWN: 1001,
  NO_HELLO: 4001,
  PING_TIMEOUT: 4002,
  PROTOCOL_ERROR: 4003,
  AUTH_FAILED: 4004,
  SESSION_GONE: 4005,
  VERSION_MISMATCH: 4006,
} as const;
