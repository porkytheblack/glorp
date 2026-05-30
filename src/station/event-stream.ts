/**
 * Per-session fan-out of Bridge events to subscribed WebSocket clients.
 *
 * Each client carries its own monotonic `seq` so consumers can detect dropped
 * messages and request a re-hydrate. Events are wrapped in the spec's
 * `{ sessionId, seq, event }` envelope, which future-proofs multiplexed
 * connections (open question 4).
 */

import type { BridgeEvent } from "../shared/events.ts";
import type { EventEnvelope } from "./types.ts";

export interface StreamClient {
  id: string;
  send(data: string): void;
  /** Bun's ServerWebSocket.readyState; 1 === OPEN. */
  readyState: number;
  seq: number;
}

const WS_OPEN = 1;

export class EventStream {
  private clients = new Map<string, StreamClient>();

  constructor(private readonly sessionId: string) {}

  add(client: StreamClient): void {
    this.clients.set(client.id, client);
  }

  remove(id: string): void {
    this.clients.delete(id);
  }

  get size(): number {
    return this.clients.size;
  }

  /** Envelope an event and send it to every connected client. */
  broadcast(event: BridgeEvent): void {
    for (const client of this.clients.values()) {
      this.sendOne(client, event);
    }
  }

  /** Envelope an event and send it to a single client by id. */
  sendTo(clientId: string, event: BridgeEvent): void {
    const client = this.clients.get(clientId);
    if (client) this.sendOne(client, event);
  }

  private sendOne(client: StreamClient, event: BridgeEvent): void {
    if (client.readyState !== WS_OPEN) return;
    const envelope: EventEnvelope = {
      sessionId: this.sessionId,
      seq: ++client.seq,
      event,
    };
    try {
      client.send(JSON.stringify(envelope));
    } catch {
      // Socket is broken; the close handler removes it.
    }
  }
}
