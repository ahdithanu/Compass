import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { SynthesisContext } from "@/lib/claude";

// Mock the reasoning layer so we can drive the multi-agent gate / revise-once /
// fallback branches deterministically, without calling the real API.
vi.mock("@/lib/claude", () => ({
  synthesize: vi.fn(),
  critique: vi.fn(),
}));

import { runRecommendationPipeline } from "@/lib/pipeline";
import { synthesize, critique } from "@/lib/claude";

const profile = {
  age: 35,
  goal: "growth",
  riskTolerance: "moderate",
  horizonYears: 20,
  journeyStage: "building",
  interests: ["AI"],
};

// Build a draft that covers exactly the candidates the pipeline chose.
function goodDraft(ctx: SynthesisContext) {
  return {
    summary: "A diversified plan for your profile.",
    theMove: { headline: "Stay the course", reasoning: "Consistent contributions." },
    sectorsToWatch: ctx.sectors,
    pickRationales: ctx.candidates.map((c) => ({
      ticker: c.ticker,
      rationale: `${c.bucket} holding`,
    })),
  };
}

beforeEach(() => {
  (synthesize as Mock).mockReset();
  (critique as Mock).mockReset();
});

describe("runRecommendationPipeline (LLM mocked)", () => {
  it("uses Claude reasoning when synthesis passes both critic gates", async () => {
    (synthesize as Mock).mockImplementation(async (ctx: SynthesisContext) =>
      goodDraft(ctx),
    );
    (critique as Mock).mockResolvedValue({ passed: true, issues: [] });

    const rec = await runRecommendationPipeline(profile);

    expect(rec.meta.reasoningSource).toBe("claude");
    expect(synthesize).toHaveBeenCalledTimes(1);
    // every check passed
    expect(rec.meta.checks.every((c) => c.passed)).toBe(true);
    // rationales came from the (mocked) synthesizer
    expect(rec.picks.every((p) => p.rationale.includes("holding"))).toBe(true);
  });

  it("revises once when the first draft hallucinates a ticker, then succeeds", async () => {
    (synthesize as Mock)
      .mockImplementationOnce(async (ctx: SynthesisContext) => ({
        ...goodDraft(ctx),
        pickRationales: [
          ...goodDraft(ctx).pickRationales,
          { ticker: "FAKE", rationale: "not a candidate" },
        ],
      }))
      .mockImplementation(async (ctx: SynthesisContext) => goodDraft(ctx));
    (critique as Mock).mockResolvedValue({ passed: true, issues: [] });

    const rec = await runRecommendationPipeline(profile);

    expect(synthesize).toHaveBeenCalledTimes(2); // revised once
    expect(rec.meta.reasoningSource).toBe("claude");
    // the first attempt's hallucination check is recorded as failed
    const attempt1 = rec.meta.checks.find(
      (c) => c.name === "no_hallucinated_tickers_attempt1",
    );
    expect(attempt1?.passed).toBe(false);
    // the second attempt passes
    const attempt2 = rec.meta.checks.find(
      (c) => c.name === "no_hallucinated_tickers_attempt2",
    );
    expect(attempt2?.passed).toBe(true);
  });

  it("falls back to rule-based reasoning when the critic rejects both attempts", async () => {
    (synthesize as Mock).mockImplementation(async (ctx: SynthesisContext) =>
      goodDraft(ctx),
    );
    (critique as Mock).mockResolvedValue({
      passed: false,
      issues: ["unsuitable for risk profile"],
    });

    const rec = await runRecommendationPipeline(profile);

    expect(synthesize).toHaveBeenCalledTimes(2);
    expect(rec.meta.reasoningSource).toBe("rule_based");
    // user still gets a valid result with rationales (the safe fallback)
    expect(rec.picks.every((p) => p.rationale.trim().length > 0)).toBe(true);
    expect(rec.allocation.stocks + rec.allocation.bonds + rec.allocation.cash + rec.allocation.alternatives).toBe(100);
  });
});
