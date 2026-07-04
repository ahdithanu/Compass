import { describe, it, expect, afterEach, vi } from "vitest";
import { parseDsn, isSentryConfigured, captureException } from "@/lib/sentry";

describe("parseDsn", () => {
  it("parses a modern DSN into host, project, and public key", () => {
    expect(parseDsn("https://abc123@o1.ingest.sentry.io/456")).toEqual({
      host: "o1.ingest.sentry.io",
      projectId: "456",
      publicKey: "abc123",
    });
  });

  it("returns null for missing/garbage DSNs", () => {
    expect(parseDsn(undefined)).toBeNull();
    expect(parseDsn("")).toBeNull();
    expect(parseDsn("not a url")).toBeNull();
    expect(parseDsn("https://o1.ingest.sentry.io/456")).toBeNull(); // no public key
    expect(parseDsn("https://abc@o1.ingest.sentry.io/")).toBeNull(); // no project id
  });
});

describe("captureException", () => {
  const ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ENV };
    vi.unstubAllGlobals();
  });

  it("no-ops (no network) when SENTRY_DSN is unset", async () => {
    delete process.env.SENTRY_DSN;
    expect(isSentryConfigured()).toBe(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await captureException(new Error("boom"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the event to the ingest endpoint with the auth header when configured", async () => {
    process.env.SENTRY_DSN = "https://pub@o9.ingest.sentry.io/42";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await captureException(new Error("kaboom"), { requestId: "req_1", scope: "recs" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://o9.ingest.sentry.io/api/42/store/");
    expect(init.method).toBe("POST");
    expect(init.headers["x-sentry-auth"]).toContain("sentry_key=pub");
    const body = JSON.parse(init.body);
    expect(body.exception.values[0].value).toBe("kaboom");
    expect(body.tags.request_id).toBe("req_1");
  });

  it("never throws when the network fails", async () => {
    process.env.SENTRY_DSN = "https://pub@o9.ingest.sentry.io/42";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    await expect(captureException(new Error("x"))).resolves.toBeUndefined();
  });
});
