/**
 * SessionStats.lastError — lets a polled `GET /sessions/:id/result` consumer
 * tell a *failed* turn (e.g. a model 400 surfaced as a bridge `error` event)
 * from an *empty* one, without the WebSocket stream.
 */

import { describe, it, expect } from "bun:test";
import { SessionStats } from "../src/garage/session-stats.ts";
import type { BridgeEvent } from "../src/shared/events.ts";

function feed(stats: SessionStats, ...events: BridgeEvent[]): void {
  for (const ev of events) stats.apply(ev);
}

describe("SessionStats.lastError", () => {
  it("starts null", () => {
    expect(new SessionStats().lastError).toBeNull();
  });

  it("captures an error event's message (and detail when present)", () => {
    const stats = new SessionStats();
    feed(stats, { type: "error", message: "400 … 512000 in the output", detail: "context overflow" });
    expect(stats.lastError).toBe("400 … 512000 in the output: context overflow");
  });

  it("a failed turn leaves lastError set after busy:false", () => {
    const stats = new SessionStats();
    feed(
      stats,
      { type: "busy", busy: true },
      { type: "error", message: "400 context length exceeded" },
      { type: "busy", busy: false },
    );
    expect(stats.busy).toBe(false);
    expect(stats.lastError).toBe("400 context length exceeded");
  });

  it("the next turn starting clears a stale error", () => {
    const stats = new SessionStats();
    feed(stats, { type: "error", message: "old failure" }, { type: "busy", busy: true });
    expect(stats.lastError).toBeNull();
  });
});
