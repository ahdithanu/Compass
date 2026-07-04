import { describe, it, expect, afterEach, vi } from "vitest";
import {
  parseDsn,
  isSentryConfigured,
  captureException,
  sentryStoreUrl,
  buildSentryEvent,
} from "@/lib/sentry";
import { reportClientError, __resetClientErrorCount } from "@/lib/sentryClient";

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

describe("shared builders", () => {
  it("sentryStoreUrl builds the ingest endpoint", () => {
    const dsn = parseDsn("https://k@o1.ingest.sentry.io/7")!;
    expect(sentryStoreUrl(dsn)).toBe("https://o1.ingest.sentry.io/api/7/store/");
  });

  it("buildSentryEvent tags the platform and carries the message", () => {
    const ev = buildSentryEvent(new Error("nope"), { platform: "javascript", scope: "client" }) as {
      platform: string;
      logger: string;
      exception: { values: { value: string }[] };
    };
    expect(ev.platform).toBe("javascript");
    expect(ev.logger).toBe("client");
    expect(ev.exception.values[0].value).toBe("nope");
  });
});

describe("reportClientError", () => {
  const ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ENV };
    __resetClientErrorCount();
    vi.unstubAllGlobals();
  });

  it("no-ops when NEXT_PUBLIC_SENTRY_DSN is unset", () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    const beacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { sendBeacon: beacon, userAgent: "test" });
    vi.stubGlobal("window", { location: { href: "http://t/" } });
    reportClientError(new Error("x"));
    expect(beacon).not.toHaveBeenCalled();
  });

  it("beacons the event to the ingest endpoint with query auth when configured", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://pub@o2.ingest.sentry.io/9";
    const beacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { sendBeacon: beacon, userAgent: "test" });
    vi.stubGlobal("window", { location: { href: "http://t/x" } });

    reportClientError(new Error("boom"), { line: 5 });

    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, body] = beacon.mock.calls[0];
    expect(url).toContain("https://o2.ingest.sentry.io/api/9/store/");
    expect(url).toContain("sentry_key=pub");
    const ev = JSON.parse(body as string);
    expect(ev.exception.values[0].value).toBe("boom");
    expect(ev.extra.url).toBe("http://t/x");
  });

  it("caps the number of events per session", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://pub@o2.ingest.sentry.io/9";
    const beacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { sendBeacon: beacon, userAgent: "test" });
    vi.stubGlobal("window", { location: { href: "http://t/" } });
    for (let i = 0; i < 25; i++) reportClientError(new Error(`e${i}`));
    expect(beacon.mock.calls.length).toBeLessThanOrEqual(10);
  });
});
