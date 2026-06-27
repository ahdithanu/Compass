import { describe, it, expect } from "vitest";
import { diffRuns } from "@/lib/compare";
import type { Recommendation } from "@/lib/types";

function rec(
  alloc: Partial<Recommendation["allocation"]>,
  tickers: { ticker: string; name?: string; bucket?: string }[],
): Recommendation {
  return {
    allocation: { stocks: 0, bonds: 0, cash: 0, alternatives: 0, ...alloc },
    sectorsToWatch: [],
    picks: tickers.map((t) => ({
      ticker: t.ticker,
      name: t.name ?? t.ticker,
      kind: "etf",
      bucket: (t.bucket ?? "core") as Recommendation["picks"][number]["bucket"],
      rationale: "",
    })),
    theMove: { headline: "", reasoning: "" },
    summary: "",
    disclaimers: [],
    meta: {
      traceId: "t",
      generatedAt: "t",
      dataSource: "fallback",
      reasoningSource: "rule_based",
      checks: [],
    },
  };
}

describe("diffRuns", () => {
  it("computes signed allocation deltas (newer minus older)", () => {
    const from = rec({ stocks: 70, bonds: 25, cash: 5 }, [{ ticker: "VTI" }]);
    const to = rec({ stocks: 60, bonds: 35, cash: 5 }, [{ ticker: "VTI" }]);
    const d = diffRuns(from, to);
    const byKey = Object.fromEntries(d.allocation.map((a) => [a.key, a.delta]));
    expect(byKey.stocks).toBe(-10);
    expect(byKey.bonds).toBe(10);
    expect(byKey.cash).toBe(0);
  });

  it("classifies picks as added / removed / held", () => {
    const from = rec({ stocks: 100 }, [{ ticker: "VTI" }, { ticker: "BND" }]);
    const to = rec({ stocks: 100 }, [{ ticker: "VTI" }, { ticker: "QQQM" }]);
    const d = diffRuns(from, to);
    expect(d.added.map((p) => p.ticker)).toEqual(["QQQM"]);
    expect(d.removed.map((p) => p.ticker)).toEqual(["BND"]);
    expect(d.held.map((p) => p.ticker)).toEqual(["VTI"]);
  });

  it("flags an identical pair as unchanged", () => {
    const a = rec({ stocks: 80, bonds: 20 }, [{ ticker: "VTI" }]);
    const b = rec({ stocks: 80, bonds: 20 }, [{ ticker: "VTI" }]);
    expect(diffRuns(a, b).unchanged).toBe(true);
  });

  it("is not unchanged when only the mix moved", () => {
    const a = rec({ stocks: 80, bonds: 20 }, [{ ticker: "VTI" }]);
    const b = rec({ stocks: 81, bonds: 19 }, [{ ticker: "VTI" }]);
    expect(diffRuns(a, b).unchanged).toBe(false);
  });
});
