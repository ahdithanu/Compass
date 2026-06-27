import { describe, it, expect } from "vitest";
import { evidenceForTicker } from "@/lib/explain";
import type { InsightDigest } from "@/lib/types";

function digest(over: Partial<InsightDigest> = {}): InsightDigest {
  return {
    headline: "h",
    insights: [
      {
        title: "AI capex is a multi-year cycle",
        summary: "s",
        soWhat: "Leans your thematic sleeve toward chips.",
        relatedTickers: ["SMH", "QQQM"],
        sourceIds: ["n1"],
      },
      {
        title: "Rotation into bonds",
        summary: "s",
        soWhat: "Adds ballast.",
        relatedTickers: ["BND"],
        sourceIds: ["n2"],
      },
    ],
    sources: [
      { id: "n1", title: "Chips note", source: "Letter", publishedAt: "t", tickers: ["SMH"], summary: "" },
      { id: "n2", title: "Bond note", source: "Macro", publishedAt: "t", tickers: ["BND", "BNDX"], summary: "" },
    ],
    disclaimers: [],
    meta: {
      traceId: "t",
      generatedAt: "t",
      dataSource: "fallback",
      reasoningSource: "rule_based",
      checks: [],
    },
    ...over,
  };
}

describe("evidenceForTicker", () => {
  it("returns the insight + source that mention the ticker", () => {
    const e = evidenceForTicker("SMH", digest());
    expect(e.insights.map((i) => i.title)).toEqual(["AI capex is a multi-year cycle"]);
    expect(e.sources.map((s) => s.id)).toEqual(["n1"]);
  });

  it("is case-insensitive", () => {
    expect(evidenceForTicker("smh", digest()).insights).toHaveLength(1);
  });

  it("matches exact tickers only (BND does not match BNDX)", () => {
    const e = evidenceForTicker("BND", digest());
    expect(e.sources.map((s) => s.id)).toEqual(["n2"]); // tagged BND
    const x = evidenceForTicker("BNDX", digest());
    expect(x.insights).toHaveLength(0); // no insight references BNDX
    expect(x.sources.map((s) => s.id)).toEqual(["n2"]); // but the source tags it
  });

  it("returns empty evidence for an unrelated ticker", () => {
    const e = evidenceForTicker("VTI", digest());
    expect(e.insights).toHaveLength(0);
    expect(e.sources).toHaveLength(0);
  });

  it("handles a missing digest", () => {
    const e = evidenceForTicker("SMH", null);
    expect(e).toEqual({ insights: [], sources: [] });
  });
});
