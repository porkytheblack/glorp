import { describe, test, expect } from "bun:test";
import { classifyModelError, formatDuration } from "../src/shared/error-classify.ts";

describe("classifyModelError", () => {
  test("auth: 401 invalid key (the Moonshot/Xiaomi shape)", () => {
    const c = classifyModelError(new Error("401 Invalid Authentication — Error: 401 Invalid Authentication at generate"));
    expect(c.kind).toBe("auth");
    expect(c.title).toContain("rejected the API key");
    expect(c.hint).toContain("Models");
  });

  test("quota: TPD limit with retry-after in the message", () => {
    const c = classifyModelError(new Error("429 request reached organization TPD rate limit, retry-after: 1727"));
    expect(c.kind).toBe("quota");
    expect(c.retryAfterSec).toBe(1727);
    expect(c.hint).toContain("29 min");
  });

  test("rate limit: plain 429 without quota wording", () => {
    const c = classifyModelError(new Error("429 Too Many Requests"));
    expect(c.kind).toBe("rate_limit");
  });

  test("rate limit: reads retry-after from SDK-style headers", () => {
    const err = Object.assign(new Error("Rate limit reached"), {
      status: 429,
      headers: { get: (k: string) => (k === "retry-after" ? "60" : null) },
    });
    const c = classifyModelError(err);
    expect(c.kind).toBe("rate_limit");
    expect(c.retryAfterSec).toBe(60);
  });

  test("network: fetch failure", () => {
    expect(classifyModelError(new Error("fetch failed: ECONNREFUSED 127.0.0.1:9")).kind).toBe("network");
  });

  test("upstream: 5xx and 400-contract errors", () => {
    expect(classifyModelError(new Error("502 Bad Gateway")).kind).toBe("upstream");
    expect(classifyModelError(new Error("400 thinking is enabled but reasoning_content is missing in assistant tool call message")).kind).toBe("upstream");
  });

  test("internal: anything unrecognized", () => {
    expect(classifyModelError(new Error("undefined is not a function")).kind).toBe("internal");
  });
});

describe("formatDuration", () => {
  test("seconds, minutes, hours", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(1727)).toBe("29 min");
    expect(formatDuration(7200)).toBe("2.0 h");
  });
});
