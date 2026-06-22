// Route-handler tests for the API layer. These exercise auth gating, request
// validation, status codes and error mapping — the glue around the pipeline and
// DB that the lib-level unit tests don't cover. Supabase, the pipelines and
// persistence are mocked so the handlers run hermetically in the node env.

import { describe, it, expect, beforeEach, vi } from "vitest";

// Shared, hoisted holder the module mocks read from. Each test mutates it to
// stage the world (configured?, current user, staged DB results, pipeline result).
const H = vi.hoisted(() => ({
  configured: true,
  client: null as unknown,
  runRec: vi.fn(),
  runIns: vi.fn(),
  persist: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => H.client),
  isSupabaseConfigured: () => H.configured,
}));

vi.mock("@/lib/persistence", () => ({
  persistRun: (...args: unknown[]) => H.persist(...args),
}));

// Keep the real PipelineError (routes use `instanceof`) but stub the pipeline fn.
vi.mock("@/lib/pipeline", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, runRecommendationPipeline: (...a: unknown[]) => H.runRec(...a) };
});

vi.mock("@/lib/insights", () => ({
  runInsightsPipeline: (...a: unknown[]) => H.runIns(...a),
}));

import { PipelineError } from "@/lib/pipeline";
import { __resetRateLimit } from "@/lib/ratelimit";

// --- a tiny chainable + thenable fake of the Supabase query builder ----------
type TableResults = Record<string, { data?: unknown; error?: unknown; count?: number }>;

function fakeSupabase(opts: { user?: unknown; results?: TableResults }) {
  const { user = null, results = {} } = opts;
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from(table: string) {
      const result = results[table] ?? { data: null, error: null };
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const m of ["select", "insert", "update", "delete", "eq", "order", "limit"]) {
        builder[m] = chain;
      }
      builder.single = chain;
      // Make the builder awaitable at any point in the chain.
      builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(result).then(res, rej);
      return builder;
    },
  };
}

beforeEach(() => {
  H.configured = true;
  H.client = null;
  H.runRec.mockReset();
  H.runIns.mockReset();
  H.persist.mockReset();
  __resetRateLimit(); // isolate cases — buckets are process-global
});

// ---------------------------------------------------------------------------
// /api/feeds
// ---------------------------------------------------------------------------
describe("/api/feeds", () => {
  it("GET returns the user's feeds when signed in", async () => {
    const { GET } = await import("@/app/api/feeds/route");
    H.client = fakeSupabase({
      user: { id: "u1" },
      results: {
        user_feeds: {
          data: [{ id: "f1", name: "Ben", url: "https://x.com/r", category: null, created_at: "t" }],
        },
      },
    });
    const res = await GET(new Request("http://t/api/feeds"));
    expect(res.status).toBe(200);
    expect((await res.json()).feeds).toHaveLength(1);
  });

  it("GET returns an empty list when Supabase isn't configured", async () => {
    const { GET } = await import("@/app/api/feeds/route");
    H.configured = false;
    const res = await GET(new Request("http://t/api/feeds"));
    expect(await res.json()).toEqual({ feeds: [] });
  });

  it("POST rejects anonymous users with 401", async () => {
    const { POST } = await import("@/app/api/feeds/route");
    H.client = fakeSupabase({ user: null });
    const res = await POST(
      new Request("http://t/api/feeds", { method: "POST", body: JSON.stringify({ url: "https://x.com/r" }) }),
    );
    expect(res.status).toBe(401);
  });

  it("POST rejects an invalid feed URL with 400", async () => {
    const { POST } = await import("@/app/api/feeds/route");
    H.client = fakeSupabase({ user: { id: "u1" } });
    const res = await POST(
      new Request("http://t/api/feeds", { method: "POST", body: JSON.stringify({ url: "not a url" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("POST stores a valid feed and returns 201", async () => {
    const { POST } = await import("@/app/api/feeds/route");
    const stored = { id: "f9", name: "example.com", url: "https://www.example.com/feed.xml", category: null, created_at: "t" };
    H.client = fakeSupabase({ user: { id: "u1" }, results: { user_feeds: { data: stored } } });
    const res = await POST(
      new Request("http://t/api/feeds", { method: "POST", body: JSON.stringify({ url: "https://www.example.com/feed.xml" }) }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).feed).toEqual(stored);
  });

  it("POST rejects once the per-user feed quota is reached (422)", async () => {
    const { POST } = await import("@/app/api/feeds/route");
    H.client = fakeSupabase({ user: { id: "u1" }, results: { user_feeds: { count: 50 } } });
    const res = await POST(
      new Request("http://t/api/feeds", { method: "POST", body: JSON.stringify({ url: "https://x.com/r" }) }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/maximum/i);
  });

  it("POST maps a unique-violation to 409", async () => {
    const { POST } = await import("@/app/api/feeds/route");
    H.client = fakeSupabase({ user: { id: "u1" }, results: { user_feeds: { data: null, error: { code: "23505" } } } });
    const res = await POST(
      new Request("http://t/api/feeds", { method: "POST", body: JSON.stringify({ url: "https://x.com/r" }) }),
    );
    expect(res.status).toBe(409);
  });

  it("DELETE requires a feed id", async () => {
    const { DELETE } = await import("@/app/api/feeds/route");
    H.client = fakeSupabase({ user: { id: "u1" } });
    const res = await DELETE(new Request("http://t/api/feeds", { method: "DELETE" }));
    expect(res.status).toBe(400);
  });

  it("DELETE removes the feed and returns ok", async () => {
    const { DELETE } = await import("@/app/api/feeds/route");
    H.client = fakeSupabase({ user: { id: "u1" }, results: { user_feeds: { error: null } } });
    const res = await DELETE(new Request("http://t/api/feeds?id=f1", { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// /api/recommendations
// ---------------------------------------------------------------------------
describe("/api/recommendations", () => {
  const post = async (body?: unknown) => {
    const { POST } = await import("@/app/api/recommendations/route");
    return POST(
      new Request("http://t/api/recommendations", {
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  };

  it("returns 400 when no profile is posted and none is saved", async () => {
    H.configured = false;
    const res = await post();
    expect(res.status).toBe(400);
  });

  it("runs the pipeline for a posted profile and persists the run", async () => {
    H.runRec.mockResolvedValue({ traceId: "t1" });
    const res = await post({ profile: { age: 30 } });
    expect(res.status).toBe(200);
    expect((await res.json()).recommendation).toEqual({ traceId: "t1" });
    expect(H.runRec).toHaveBeenCalledWith({ age: 30 });
    expect(H.persist).toHaveBeenCalledWith("recommendation", { traceId: "t1" });
  });

  it("maps a PipelineError to 422 with its issues", async () => {
    H.runRec.mockRejectedValue(new PipelineError("bad profile", ["age required"]));
    const res = await post({ profile: {} });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "bad profile", issues: ["age required"] });
  });

  it("maps an unexpected error to 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    H.runRec.mockRejectedValue(new Error("boom"));
    const res = await post({ profile: { age: 30 } });
    expect(res.status).toBe(500);
  });

  it("loads the saved profile when none is posted", async () => {
    H.runRec.mockResolvedValue({ traceId: "t2" });
    H.client = fakeSupabase({
      user: { id: "u1" },
      results: {
        profiles: {
          data: { age: 40, goal: "growth", risk_tolerance: "high", horizon_years: 20, journey_stage: "building", monthly_contribution: 500, interests: ["ai"] },
        },
      },
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(H.runRec).toHaveBeenCalledWith(
      expect.objectContaining({ age: 40, riskTolerance: "high", horizonYears: 20, monthlyContribution: 500 }),
    );
  });

  it("returns 401 when no profile is posted and the user is anonymous", async () => {
    H.client = fakeSupabase({ user: null });
    const res = await post();
    expect(res.status).toBe(401);
  });

  it("returns 404 when the signed-in user has no saved profile", async () => {
    H.client = fakeSupabase({ user: { id: "u1" }, results: { profiles: { data: null } } });
    const res = await post();
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// /api/insights
// ---------------------------------------------------------------------------
describe("/api/insights", () => {
  const post = async (body?: unknown) => {
    const { POST } = await import("@/app/api/insights/route");
    return POST(
      new Request("http://t/api/insights", {
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  };

  it("runs the insights pipeline for a posted profile", async () => {
    H.configured = false; // skip the supabase branch entirely
    H.runIns.mockResolvedValue({ traceId: "i1" });
    const res = await post({ profile: { age: 30 } });
    expect(res.status).toBe(200);
    expect((await res.json()).digest).toEqual({ traceId: "i1" });
    expect(H.persist).toHaveBeenCalledWith("insights", { traceId: "i1" });
  });

  it("passes the user's custom feeds to the pipeline", async () => {
    H.runIns.mockResolvedValue({ traceId: "i2" });
    H.client = fakeSupabase({
      user: { id: "u1" },
      results: {
        profiles: { data: { age: 30, goal: "growth", risk_tolerance: "med", horizon_years: 10, journey_stage: "building", interests: [] } },
        user_feeds: { data: [{ id: "f1", name: "Ben", url: "https://x.com/r", category: "macro" }] },
      },
    });
    await post();
    expect(H.runIns).toHaveBeenCalledWith(
      expect.any(Object),
      { feeds: [{ name: "Ben", url: "https://x.com/r", category: "macro" }] },
    );
  });

  it("maps a PipelineError to 422", async () => {
    H.configured = false;
    H.runIns.mockRejectedValue(new PipelineError("nope", ["x"]));
    const res = await post({ profile: { age: 30 } });
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// /api/history
// ---------------------------------------------------------------------------
describe("/api/history", () => {
  it("returns an empty list when Supabase isn't configured", async () => {
    const { GET } = await import("@/app/api/history/route");
    H.configured = false;
    expect(await (await GET(new Request("http://t/api/history"))).json()).toEqual({ runs: [] });
  });

  it("returns an empty list for anonymous users", async () => {
    const { GET } = await import("@/app/api/history/route");
    H.client = fakeSupabase({ user: null });
    expect(await (await GET(new Request("http://t/api/history"))).json()).toEqual({ runs: [] });
  });

  it("returns the user's recent runs", async () => {
    const { GET } = await import("@/app/api/history/route");
    const runs = [{ id: "r1", kind: "insights", checks_passed: 3, checks_total: 3 }];
    H.client = fakeSupabase({ user: { id: "u1" }, results: { runs: { data: runs } } });
    const res = await GET(new Request("http://t/api/history"));
    expect(res.status).toBe(200);
    expect((await res.json()).runs).toEqual(runs);
  });
});

// ---------------------------------------------------------------------------
// Hardening: rate limiting + body-size caps on the POST routes
// ---------------------------------------------------------------------------
describe("POST route hardening", () => {
  const ip = (addr: string) => ({ "x-forwarded-for": addr });

  it("recommendations returns 429 once the per-client window is exhausted", async () => {
    process.env.API_RATE_LIMIT_RECS = "2";
    H.runRec.mockResolvedValue({ traceId: "t" });
    const { POST } = await import("@/app/api/recommendations/route");
    const call = () =>
      POST(new Request("http://t/api/recommendations", { method: "POST", headers: ip("7.7.7.7"), body: JSON.stringify({ profile: { age: 30 } }) }));

    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    delete process.env.API_RATE_LIMIT_RECS;
  });

  it("rate-limit buckets are per-client (a second IP is unaffected)", async () => {
    process.env.API_RATE_LIMIT_RECS = "1";
    H.runRec.mockResolvedValue({ traceId: "t" });
    const { POST } = await import("@/app/api/recommendations/route");
    const call = (addr: string) =>
      POST(new Request("http://t/api/recommendations", { method: "POST", headers: ip(addr), body: JSON.stringify({ profile: { age: 30 } }) }));

    expect((await call("1.1.1.1")).status).toBe(200);
    expect((await call("1.1.1.1")).status).toBe(429); // first client exhausted
    expect((await call("2.2.2.2")).status).toBe(200); // different client, fresh budget
    delete process.env.API_RATE_LIMIT_RECS;
  });

  it("recommendations rejects an over-cap body with 413", async () => {
    const { POST } = await import("@/app/api/recommendations/route");
    const huge = JSON.stringify({ profile: { note: "a".repeat(20_000) } });
    const res = await POST(new Request("http://t/api/recommendations", { method: "POST", body: huge }));
    expect(res.status).toBe(413);
  });

  it("insights rejects an over-cap body with 413", async () => {
    H.configured = false;
    const { POST } = await import("@/app/api/insights/route");
    const huge = JSON.stringify({ profile: { note: "a".repeat(20_000) } });
    const res = await POST(new Request("http://t/api/insights", { method: "POST", body: huge }));
    expect(res.status).toBe(413);
  });

  it("feeds POST rejects an over-cap body with 413 (before touching auth)", async () => {
    H.client = fakeSupabase({ user: { id: "u1" } });
    const { POST } = await import("@/app/api/feeds/route");
    const huge = JSON.stringify({ url: "https://x.com/" + "a".repeat(20_000) });
    const res = await POST(new Request("http://t/api/feeds", { method: "POST", body: huge }));
    expect(res.status).toBe(413);
  });
});

// ---------------------------------------------------------------------------
// Request-id correlation (withRequest wrapper)
// ---------------------------------------------------------------------------
describe("request-id wrapping", () => {
  it("stamps every response with an x-request-id", async () => {
    H.runIns.mockResolvedValue({ traceId: "i" });
    H.configured = false;
    const { POST } = await import("@/app/api/insights/route");
    const res = await POST(new Request("http://t/api/insights", { method: "POST", body: JSON.stringify({ profile: { age: 30 } }) }));
    expect(res.headers.get("x-request-id")).toMatch(/^req_/);
  });

  it("honors a client-supplied correlation id", async () => {
    const { GET } = await import("@/app/api/history/route");
    H.configured = false;
    const res = await GET(new Request("http://t/api/history", { headers: { "x-request-id": "trace-abc.123" } }));
    expect(res.headers.get("x-request-id")).toBe("trace-abc.123");
  });

  it("ignores a junk correlation id and mints its own", async () => {
    const { GET } = await import("@/app/api/history/route");
    H.configured = false;
    const res = await GET(new Request("http://t/api/history", { headers: { "x-request-id": "has spaces & symbols!" } }));
    expect(res.headers.get("x-request-id")).toMatch(/^req_/);
  });

  it("turns an uncaught handler error into a 500 carrying the request id", async () => {
    H.runRec.mockRejectedValue(new Error("kaboom"));
    const { POST } = await import("@/app/api/recommendations/route");
    const res = await POST(new Request("http://t/api/recommendations", { method: "POST", body: JSON.stringify({ profile: { age: 30 } }) }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error.");
    expect(body.requestId).toBe(res.headers.get("x-request-id"));
  });
});
