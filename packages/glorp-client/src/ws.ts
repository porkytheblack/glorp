/**
 * Session event stream over WebSocket. The API key travels as a `?api_key=`
 * query param (WS can't set headers from a browser). Exposes both a callback
 * (`onEvent`) and an async-iterator interface so you can `for await` the events.
 */

import type { GlorpConfig } from "./config.js";
import type { BridgeEvent, EventEnvelope } from "./contract.js";

export interface SessionStream {
  close(): void;
  [Symbol.asyncIterator](): AsyncIterator<BridgeEvent>;
}

export function streamSessionWith(
  cfg: GlorpConfig,
  sessionId: string,
  onEvent?: (event: BridgeEvent) => void,
): SessionStream {
  const WS = cfg.WebSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!WS) throw new Error("No WebSocket implementation. Pass WebSocketImpl to configure() (e.g. Node's `ws`).");

  const wsBase = cfg.endpoint.replace(/^http/, "ws");
  const q = cfg.apiKey ? `?api_key=${encodeURIComponent(cfg.apiKey)}` : "";
  const ws = new WS(`${wsBase}/api/v1/sessions/${encodeURIComponent(sessionId)}/events${q}`);

  const queue: BridgeEvent[] = [];
  let pending: ((r: IteratorResult<BridgeEvent>) => void) | null = null;
  let done = false;

  const finish = () => {
    done = true;
    if (pending) {
      pending({ value: undefined as never, done: true });
      pending = null;
    }
  };

  ws.onmessage = (ev: MessageEvent) => {
    if (typeof ev.data !== "string") return;
    let env: EventEnvelope | null = null;
    try {
      env = JSON.parse(ev.data) as EventEnvelope;
    } catch {
      return;
    }
    if (!env || !env.event) return;
    onEvent?.(env.event);
    if (pending) {
      pending({ value: env.event, done: false });
      pending = null;
    } else {
      queue.push(env.event);
    }
  };
  ws.onclose = finish;
  ws.onerror = finish;

  return {
    close() {
      done = true;
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    },
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<BridgeEvent>> {
          if (queue.length) return Promise.resolve({ value: queue.shift() as BridgeEvent, done: false });
          if (done) return Promise.resolve({ value: undefined as never, done: true });
          return new Promise((resolve) => {
            pending = resolve;
          });
        },
      };
    },
  };
}
