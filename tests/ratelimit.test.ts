import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, clientKey, __resetRateLimit } from "@/lib/ratelimit";
import { readJsonCapped, BodyTooLargeError, MAX_BODY_BYTES } from "@/lib/http";

beforeEach(() => __resetRateLimit());

describe("rateLimit", () => {
  it("allows up to the limit, then blocks within the window", () => {
    const key = "t:1.2.3.4";
    expect(rateLimit(key, 3, 1000, 0).ok).toBe(true); // 1
    expect(rateLimit(key, 3, 1000, 10).ok).toBe(true); // 2
    const third = rateLimit(key, 3, 1000, 20);
    expect(third.ok).toBe(true); // 3 (at the limit)
    expect(third.remaining).toBe(0);

    const blocked = rateLimit(key, 3, 1000, 30); // 4 -> over
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("resets once the window elapses", () => {
    const key = "t:5.6.7.8";
    rateLimit(key, 1, 1000, 0);
    expect(rateLimit(key, 1, 1000, 500).ok).toBe(false); // same window
    expect(rateLimit(key, 1, 1000, 1000).ok).toBe(true); // new window
  });

  it("tracks distinct keys independently", () => {
    expect(rateLimit("a", 1, 1000, 0).ok).toBe(true);
    expect(rateLimit("b", 1, 1000, 0).ok).toBe(true); // different key, fresh budget
    expect(rateLimit("a", 1, 1000, 0).ok).toBe(false);
  });

  it("reports a Retry-After of at least 1 second when blocked", () => {
    rateLimit("c", 1, 800, 0);
    const blocked = rateLimit("c", 1, 800, 700); // 100ms left -> ceil to 1s, min 1
    expect(blocked.retryAfterSec).toBe(1);
  });
});

describe("clientKey", () => {
  it("uses the first x-forwarded-for hop and scopes by route", () => {
    const req = new Request("http://t", { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } });
    expect(clientKey(req, "recs")).toBe("recs:9.9.9.9");
  });

  it("falls back to x-real-ip, then a constant", () => {
    expect(clientKey(new Request("http://t", { headers: { "x-real-ip": "8.8.8.8" } }), "f")).toBe("f:8.8.8.8");
    expect(clientKey(new Request("http://t"), "f")).toBe("f:local");
  });
});

describe("readJsonCapped", () => {
  it("parses a normal JSON body", async () => {
    const req = new Request("http://t", { method: "POST", body: JSON.stringify({ a: 1 }) });
    expect(await readJsonCapped(req)).toEqual({ a: 1 });
  });

  it("returns undefined for an empty body", async () => {
    const req = new Request("http://t", { method: "POST" });
    expect(await readJsonCapped(req)).toBeUndefined();
  });

  it("throws SyntaxError on malformed JSON", async () => {
    const req = new Request("http://t", { method: "POST", body: "{not json" });
    await expect(readJsonCapped(req)).rejects.toBeInstanceOf(SyntaxError);
  });

  it("throws BodyTooLargeError when the body exceeds the cap", async () => {
    const big = JSON.stringify({ x: "a".repeat(MAX_BODY_BYTES + 1) });
    const req = new Request("http://t", { method: "POST", body: big });
    await expect(readJsonCapped(req)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("rejects early when Content-Length declares an over-cap body", async () => {
    const req = new Request("http://t", {
      method: "POST",
      body: "{}",
      headers: { "content-length": String(MAX_BODY_BYTES + 100) },
    });
    await expect(readJsonCapped(req)).rejects.toBeInstanceOf(BodyTooLargeError);
  });
});
