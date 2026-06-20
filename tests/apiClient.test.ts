import { describe, it, expect, vi, afterEach } from "vitest";
import { apiGet, apiPost, apiDelete, apiRequest, withRef } from "@/lib/apiClient";

/** Build a fetch-like Response stub. */
function res(opts: {
  ok: boolean;
  status: number;
  reqId?: string | null;
  body?: unknown;
  noJson?: boolean;
}) {
  return {
    ok: opts.ok,
    status: opts.status,
    headers: { get: (h: string) => (h.toLowerCase() === "x-request-id" ? opts.reqId ?? null : null) },
    json: async () => {
      if (opts.noJson) throw new Error("not json");
      return opts.body;
    },
  } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe("apiRequest", () => {
  it("returns ok + data + the request id on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ ok: true, status: 200, reqId: "req_abc", body: { x: 1 } })));
    const r = await apiGet<{ x: number }>("/api/thing");
    expect(r).toEqual({ ok: true, data: { x: 1 }, requestId: "req_abc" });
  });

  it("surfaces the server error message, issues, status and id on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ ok: false, status: 422, reqId: "req_x", body: { error: "bad", issues: ["a", "b"] } })));
    const r = await apiRequest("/api/thing", { method: "POST" });
    expect(r).toMatchObject({ ok: false, status: 422, error: "bad", issues: ["a", "b"], requestId: "req_x" });
  });

  it("falls back to a friendly per-status message when the body has none", async () => {
    const cases: Array<[number, RegExp]> = [
      [401, /sign in/i],
      [429, /fast/i],
      [500, /our end/i],
      [418, /something went wrong/i],
    ];
    for (const [status, re] of cases) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ ok: false, status, body: {} })));
      const r = await apiGet("/api/thing");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(re);
    }
  });

  it("treats a thrown fetch as a network failure (status 0, no id)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const r = await apiGet("/api/thing");
    expect(r).toMatchObject({ ok: false, status: 0, requestId: null });
    if (!r.ok) expect(r.error).toMatch(/couldn't reach/i);
  });

  it("tolerates an empty/non-JSON success body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ ok: true, status: 200, reqId: "r", noJson: true })));
    const r = await apiGet("/api/thing");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBeUndefined();
  });

  it("ignores a non-string issues array element", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ ok: false, status: 422, body: { error: "x", issues: ["good", 5, null] } })));
    const r = await apiGet("/api/thing");
    if (!r.ok) expect(r.issues).toEqual(["good"]);
  });
});

describe("apiPost / apiDelete", () => {
  it("apiPost sends JSON with the right method + headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res({ ok: true, status: 200, body: { ok: true } }));
    vi.stubGlobal("fetch", fetchMock);
    await apiPost("/api/feeds", { url: "https://x.com/r" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ url: "https://x.com/r" });
  });

  it("apiPost defaults to an empty object body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res({ ok: true, status: 200, body: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await apiPost("/api/recommendations");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({});
  });

  it("apiDelete uses the DELETE method", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res({ ok: true, status: 200, body: { ok: true } }));
    vi.stubGlobal("fetch", fetchMock);
    await apiDelete("/api/feeds?id=1");
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });
});

describe("withRef", () => {
  it("appends a ref id when present", () => {
    expect(withRef("Failed.", "req_9")).toBe("Failed. (ref: req_9)");
  });
  it("returns the message unchanged when there's no id", () => {
    expect(withRef("Failed.", null)).toBe("Failed.");
  });
});
