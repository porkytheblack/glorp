/**
 * Fan-out of Bridge events to connected WebSocket clients.
 *
 * Each client tracks its own monotonic sequence number so consumers
 * can detect dropped messages and request a resync.
 */

import type { BridgeEvent } from "../shared/events.ts";

export interface WsClient {
  id: string;
  name?: string;
  ws: { send(data: string): void; readyState: number };
  seq: number;
}

/** WebSocket readyState values (from the spec). */
const WS_OPEN = 1;

export class Broadcaster {
  private clients = new Map<string, WsClient>();

  addClient(client: WsClient): void {
    this.clients.set(client.id, client);
  }

  removeClient(id: string): WsClient | undefined {
    const client = this.clients.get(id);
    if (client) this.clients.delete(id);
    return client;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  get clientIds(): string[] {
    return [...this.clients.keys()];
  }

  /** Convert a BridgeEvent to an enveloped message and send to all clients. */
  broadcast(event: BridgeEvent): void {
    const ts = new Date().toISOString();
    for (const client of this.clients.values()) {
      if (client.ws.readyState !== WS_OPEN) continue;
      const msg = { ...event, seq: ++client.seq, ts };
      try {
        client.ws.send(JSON.stringify(msg));
      } catch {
        // Client's socket is broken; the close handler will clean up.
      }
    }
  }

  /** Send an enveloped message to a single client by id. */
  sendTo(clientId: string, event: BridgeEvent | Record<string, unknown>): void {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WS_OPEN) return;
    const msg = { ...event, seq: ++client.seq, ts: new Date().toISOString() };
    try {
      client.ws.send(JSON.stringify(msg));
    } catch {
      // Swallow — close handler handles cleanup.
    }
  }

  /**
   * Notify all OTHER clients that a peer joined or left.
   * The originating client does NOT receive this event.
   */
  broadcastPeerEvent(
    type: "peer_joined" | "peer_left",
    originClientId: string,
  ): void {
    const ts = new Date().toISOString();
    const peerCount = this.clients.size;
    for (const client of this.clients.values()) {
      if (client.id === originClientId) continue;
      if (client.ws.readyState !== WS_OPEN) continue;
      const msg = {
        type,
        client_id: originClientId,
        peer_count: peerCount,
        seq: ++client.seq,
        ts,
      };
      try {
        client.ws.send(JSON.stringify(msg));
      } catch {
        // Swallow — close handler handles cleanup.
      }
    }
  }
}
