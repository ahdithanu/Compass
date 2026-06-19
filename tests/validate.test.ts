import { describe, it, expect } from "vitest";
import {
  validateProfile,
  checkAllocation,
  checkMarketData,
  checkSynthesis,
  checkInsights,
} from "@/lib/validate";
import type {
  Allocation,
  CandidatePick,
  InsightDraft,
  NewsItem,
  SynthesisDraft,
} from "@/lib/types";

const validRaw = {
  age: 30,
  goal: "growth",
  riskTolerance: "moderate",
  horizonYears: 20,
  journeyStage: "building",
  interests: ["AI", "dividends"],
};

describe("validateProfile", () => {
  it("accepts and normalizes a valid profile", () => {
    const r = validateProfile(validRaw);
    expect(r.ok).toBe(true);
    expect(r.profile?.age).toBe(30);
    expect(r.profile?.interests).toEqual(["AI", "dividends"]);
  });

  it("rejects a non-object payload", () => {
    expect(validateProfile(null).ok).toBe(false);
    expect(validateProfile("nope").ok).toBe(false);
  });

  it("rejects out-of-range age", () => {
    expect(validateProfile({ ...validRaw, age: 12 }).ok).toBe(false);
    expect(validateProfile({ ...validRaw, age: 130 }).ok).toBe(false);
  });

  it("rejects unknown enum values", () => {
    expect(validateProfile({ ...validRaw, goal: "moon" }).ok).toBe(false);
    expect(validateProfile({ ...validRaw, riskTolerance: "yolo" }).ok).toBe(false);
    expect(validateProfile({ ...validRaw, journeyStage: "??" }).ok).toBe(false);
  });

  it("flags contradictory short-term goal with long horizon", () => {
    const r = validateProfile({ ...validRaw, goal: "short_term", horizonYears: 20 });
    expect(r.ok).toBe(false);
    expect(r.issues.join(" ")).toMatch(/short-term/i);
  });

  it("flags aggressive risk with a very short horizon", () => {
    const r = validateProfile({
      ...validRaw,
      riskTolerance: "aggressive",
      horizonYears: 2,
    });
    expect(r.ok).toBe(false);
  });

  it("caps interests at 8 and drops non-strings", () => {
    const r = validateProfile({
      ...validRaw,
      interests: ["a", "b", "c", "d", "e", "f", "g", "h", "i", 42],
    });
    expect(r.profile?.interests.length).toBe(8);
  });

  it("rejects a negative monthly contribution", () => {
    expect(validateProfile({ ...validRaw, monthlyContribution: -5 }).ok).toBe(false);
  });
});

describe("checkAllocation", () => {
  const ok: Allocation = { stocks: 60, bonds: 30, cash: 5, alternatives: 5 };

  it("passes a clean allocation summing to 100", () => {
    expect(checkAllocation(ok).passed).toBe(true);
  });

  it("fails a negative weight", () => {
    expect(checkAllocation({ ...ok, bonds: -10, stocks: 70 }).passed).toBe(false);
  });

  it("fails when the sum is off by more than rounding tolerance", () => {
    expect(checkAllocation({ stocks: 50, bonds: 30, cash: 5, alternatives: 5 }).passed).toBe(
      false,
    );
  });
});

describe("checkMarketData", () => {
  const candidates: CandidatePick[] = [
    { ticker: "VTI", name: "x", kind: "etf", bucket: "core" },
  ];
  it("always passes but records the data source", () => {
    const live = checkMarketData(["VTI"], candidates, "live");
    expect(live.passed).toBe(true);
    const fb = checkMarketData([], candidates, "fallback");
    expect(fb.detail).toMatch(/fallback/i);
  });
});

describe("checkSynthesis", () => {
  const candidates: CandidatePick[] = [
    { ticker: "VTI", name: "x", kind: "etf", bucket: "core" },
    { ticker: "BND", name: "y", kind: "etf", bucket: "defensive" },
  ];
  const good: SynthesisDraft = {
    summary: "ok",
    theMove: { headline: "do this", reasoning: "because" },
    sectorsToWatch: [],
    pickRationales: [
      { ticker: "VTI", rationale: "core" },
      { ticker: "BND", rationale: "ballast" },
    ],
  };

  it("passes a grounded synthesis", () => {
    expect(checkSynthesis(good, candidates).every((c) => c.passed)).toBe(true);
  });

  it("catches a hallucinated ticker", () => {
    const bad = {
      ...good,
      pickRationales: [...good.pickRationales, { ticker: "NVDA", rationale: "hot" }],
    };
    const res = checkSynthesis(bad, candidates);
    expect(res.find((c) => c.name === "no_hallucinated_tickers")?.passed).toBe(false);
  });

  it("catches a missing rationale", () => {
    const bad = { ...good, pickRationales: [{ ticker: "VTI", rationale: "core" }] };
    const res = checkSynthesis(bad, candidates);
    expect(res.find((c) => c.name === "all_picks_have_rationale")?.passed).toBe(false);
  });

  it("catches an empty summary / move", () => {
    const bad = { ...good, summary: "" };
    const res = checkSynthesis(bad, candidates);
    expect(res.find((c) => c.name === "has_summary_and_move")?.passed).toBe(false);
  });
});

describe("checkInsights", () => {
  const news: NewsItem[] = [
    { id: "n0", title: "t", source: "s", publishedAt: "", tickers: ["VTI"], summary: "" },
    { id: "n1", title: "u", source: "s", publishedAt: "", tickers: [], summary: "" },
  ];
  const watchlist = ["VTI", "BND"];
  const good: InsightDraft = {
    headline: "this week",
    insights: [
      { title: "a", summary: "s", soWhat: "matters", relatedTickers: ["VTI"], sourceIds: ["n0"] },
    ],
  };

  it("passes a grounded digest", () => {
    expect(checkInsights(good, news, watchlist).every((c) => c.passed)).toBe(true);
  });

  it("catches an insight citing a missing source id", () => {
    const bad = {
      ...good,
      insights: [{ ...good.insights[0], sourceIds: ["nope"] }],
    };
    expect(
      checkInsights(bad, news, watchlist).find(
        (c) => c.name === "insights_grounded_in_sources",
      )?.passed,
    ).toBe(false);
  });

  it("catches an insight with no source ids", () => {
    const bad = { ...good, insights: [{ ...good.insights[0], sourceIds: [] }] };
    expect(
      checkInsights(bad, news, watchlist).find(
        (c) => c.name === "insights_grounded_in_sources",
      )?.passed,
    ).toBe(false);
  });

  it("catches an invented ticker not in watchlist or sources", () => {
    const bad = {
      ...good,
      insights: [{ ...good.insights[0], relatedTickers: ["TSLA"] }],
    };
    expect(
      checkInsights(bad, news, watchlist).find((c) => c.name === "no_invented_tickers")
        ?.passed,
    ).toBe(false);
  });

  it("catches a missing 'so what'", () => {
    const bad = { ...good, insights: [{ ...good.insights[0], soWhat: "  " }] };
    expect(
      checkInsights(bad, news, watchlist).find((c) => c.name === "insights_have_so_what")
        ?.passed,
    ).toBe(false);
  });
});
