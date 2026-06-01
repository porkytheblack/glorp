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
  turnCount = 0;
  busy = false;

  apply(ev: BridgeEvent): void {
    switch (ev.type) {
      case "busy":
        this.busy = ev.busy;
        break;
      case "title":
        this.title = ev.title;
        break;
      case "session_hydrate":
        this.title = ev.title;
        this.tokensIn = ev.stats.tokens_in;
        this.tokensOut = ev.stats.tokens_out;
        this.turnCount = ev.stats.turns;
        break;
      case "stats":
        this.tokensIn = ev.stats.tokens_in;
        this.tokensOut = ev.stats.tokens_out;
        this.turnCount = ev.stats.turns;
        break;
    }
  }
}
