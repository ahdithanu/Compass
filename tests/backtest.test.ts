import { describe, it, expect } from "vitest";
import { backtest, type PriceSeries } from "@/lib/backtest";

function series(ticker: string, closes: [string, number][]): PriceSeries {
  return { ticker, points: closes.map(([date, close]) => ({ date, close })) };
}

describe("backtest", () => {
  it("marks a single-holding portfolio to market (100% = price change)", () => {
    const s = {
      VTI: series("VTI", [
        ["2025-01-01", 100],
        ["2025-07-01", 150],
        ["2026-01-01", 200],
      ]),
    };
    const r = backtest([{ ticker: "VTI", weight: 1 }], s, 1000);
    expect(r.startValue).toBe(1000);
    expect(r.endValue).toBe(2000); // price doubled
    expect(r.totalReturnPct).toBe(100);
    expect(r.points).toHaveLength(3);
  });

  it("blends two holdings by normalized weight", () => {
    const s = {
      A: series("A", [["2025-01-01", 100], ["2026-01-01", 200]]), // +100%
      B: series("B", [["2025-01-01", 100], ["2026-01-01", 100]]), // flat
    };
    // 50/50 of $1000: $500 doubles to $1000, $500 stays -> $1500.
    const r = backtest([{ ticker: "A", weight: 50 }, { ticker: "B", weight: 50 }], s, 1000);
    expect(r.endValue).toBe(1500);
    expect(r.totalReturnPct).toBe(50);
  });

  it("computes max drawdown from the running peak", () => {
    const s = {
      X: series("X", [
        ["2025-01-01", 100],
        ["2025-02-01", 120], // peak
        ["2025-03-01", 60], // -50% from peak
        ["2025-04-01", 90],
      ]),
    };
    const r = backtest([{ ticker: "X", weight: 1 }], s, 1000);
    expect(r.maxDrawdownPct).toBe(50);
  });

  it("annualizes over multi-year spans (CAGR)", () => {
    const s = {
      X: series("X", [["2024-01-01", 100], ["2026-01-01", 121]]), // +21% over ~2y
    };
    const r = backtest([{ ticker: "X", weight: 1 }], s, 1000);
    expect(r.totalReturnPct).toBe(21);
    expect(r.annualizedReturnPct).toBeGreaterThan(9.5); // ~10%/yr
    expect(r.annualizedReturnPct).toBeLessThan(10.5);
  });

  it("intersects dates across series with different coverage", () => {
    const s = {
      A: series("A", [["2025-01-01", 100], ["2025-02-01", 110], ["2025-03-01", 120]]),
      B: series("B", [["2025-02-01", 100], ["2025-03-01", 90]]), // starts later
    };
    const r = backtest([{ ticker: "A", weight: 1 }, { ticker: "B", weight: 1 }], s, 1000);
    // Only 2025-02 and 2025-03 are common.
    expect(r.points.map((p) => p.date)).toEqual(["2025-02-01", "2025-03-01"]);
  });

  it("drops tickers with no series and reports them", () => {
    const s = { A: series("A", [["2025-01-01", 100], ["2026-01-01", 200]]) };
    const r = backtest([{ ticker: "A", weight: 1 }, { ticker: "ZZZ", weight: 1 }], s, 1000);
    expect(r.skipped).toEqual(["ZZZ"]);
    expect(r.endValue).toBe(2000); // ran on A alone (renormalized to 100%)
  });

  it("returns a flat result when there is no usable data", () => {
    const r = backtest([{ ticker: "A", weight: 1 }], {}, 1000);
    expect(r.endValue).toBe(1000);
    expect(r.totalReturnPct).toBe(0);
    expect(r.points).toHaveLength(0);
  });
});
