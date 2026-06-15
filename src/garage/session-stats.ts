/**
 * Live, cheap-to-read snapshot of a session's stats, kept current by folding
 * the session's own BridgeEvents. Lets `toDto()` stay synchronous instead of
 * awaiting the store on every list call.
 */

import type { BridgeEvent } from "../shared/events.ts";

export class SessionStats {
  title: string | null = null;
  tokensIn = 0;
  tokensOut = 0;
  /** Cumulative estimated USD cost (catalog list pricing). */
  costUsd = 0;
  /** False once any attributed model lacked a catalog price. */
  costKnown = true;
  turnCount = 0;
  busy = false;
  /**
   * The most recent turn's `error` BridgeEvent, or null. Lets a polled
   * `GET /sessions/:id/result` consumer tell a *failed* turn (e.g. a model 400)
   * from an *empty* one (the agent finished and chose to write nothing) without
   * the WebSocket stream. Cleared when a new turn starts so it only ever
   * reflects the latest turn.
   */
  lastError: string | null = null;

  apply(ev: BridgeEvent): void {
    switch (ev.type) {
      case "busy":
        this.busy = ev.busy;
        // A new turn begins — drop any error left over from the previous one.
        if (ev.busy) this.lastError = null;
        break;
      case "error":
        this.lastError = ev.detail ? `${ev.message}: ${ev.detail}` : ev.message;
        break;
      case "title":
        this.title = ev.title;
        break;
      case "session_hydrate":
        this.title = ev.title;
        this.tokensIn = ev.stats.tokens_in;
        this.tokensOut = ev.stats.tokens_out;
        this.costUsd = ev.stats.cost_usd ?? 0;
        this.costKnown = ev.stats.cost_known ?? true;
        this.turnCount = ev.stats.turns;
        break;
      case "stats":
        this.tokensIn = ev.stats.tokens_in;
        this.tokensOut = ev.stats.tokens_out;
        this.costUsd = ev.stats.cost_usd ?? 0;
        this.costKnown = ev.stats.cost_known ?? true;
        this.turnCount = ev.stats.turns;
        break;
    }
  }
}
