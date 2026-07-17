import { describe, it, expect, afterEach, vi } from "vitest";
import { getMonthlySeries } from "@/lib/history-prices";

const NOW = Date.parse("2026-06-15T00:00:00Z");

describe("getMonthlySeries — simulated fallback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns a deterministic simulated series when no API key is set", async () => {
    delete process.env.ALPHAVANTAGE_API_KEY;
    const a = await getMonthlySeries(["VTI", "BND"], 12, NOW);
    const b = await getMonthlySeries(["VTI", "BND"], 12, NOW);
    expect(a.source).toBe("simulated");
    expect(a.series).toHaveLength(2);
    expect(a.series[0].points).toHaveLength(12);
    // Deterministic: same seed (ticker) + same now -> identical path.
    expect(a.series[0].points).toEqual(b.series[0].points);
  });

  it("gives different tickers different paths, ascending monthly dates", async () => {
    delete process.env.ALPHAVANTAGE_API_KEY;
    const { series } = await getMonthlySeries(["VTI", "BND"], 6, NOW);
    const vti = series.find((s) => s.ticker === "VTI")!;
    const bnd = series.find((s) => s.ticker === "BND")!;
    expect(vti.points[0].close).not.toBe(bnd.points[0].close);
    const dates = vti.points.map((p) => p.date);
    expect([...dates].sort()).toEqual(dates); // already ascending
  });
});

describe("getMonthlySeries — live path", () => {
  afterEach(() => {
    delete process.env.ALPHAVANTAGE_API_KEY;
    vi.unstubAllGlobals();
  });

  it("parses Alpha Vantage adjusted monthly closes when keyed", async () => {
    process.env.ALPHAVANTAGE_API_KEY = "k";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          "Monthly Adjusted Time Series": {
            "2026-06-30": { "5. adjusted close": "220.0" },
            "2026-05-31": { "5. adjusted close": "210.0" },
          },
        }),
      }),
    );
    const { series, source } = await getMonthlySeries(["VTI"], 12, NOW);
    expect(source).toBe("live");
    expect(series[0].points.map((p) => p.close)).toEqual([210, 220]); // ascending
  });

  it("falls back to simulated when the live fetch fails", async () => {
    process.env.ALPHAVANTAGE_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const { source } = await getMonthlySeries(["VTI"], 6, NOW);
    expect(source).toBe("simulated");
  });

  it("stays live with a CASH sleeve, aligning it to the live dates", async () => {
    // Regression for H-1: CASH is synthetic and must not sink an otherwise-live
    // run, and its series must share the live dates so the backtest intersects.
    process.env.ALPHAVANTAGE_API_KEY = "k";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          "Monthly Adjusted Time Series": {
            "2026-06-30": { "5. adjusted close": "220.0" },
            "2026-05-31": { "5. adjusted close": "210.0" },
          },
        }),
      }),
    );
    const { series, source } = await getMonthlySeries(["VTI", "CASH"], 12, NOW);
    expect(source).toBe("live"); // CASH did NOT force a fallback
    const vti = series.find((s) => s.ticker === "VTI")!;
    const cash = series.find((s) => s.ticker === "CASH")!;
    expect(cash.points.map((p) => p.date)).toEqual(vti.points.map((p) => p.date));
  });
});
