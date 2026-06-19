import { describe, it, expect } from "vitest";
import { runRecommendationPipeline, PipelineError } from "@/lib/pipeline";

// No API keys (cleared in setup) -> the real pipeline runs fully offline:
// sample market data + rule-based reasoning. End-to-end orchestration test.

const validProfile = {
  age: 30,
  goal: "growth",
  riskTolerance: "aggressive",
  horizonYears: 25,
  journeyStage: "building",
  interests: ["AI", "clean energy"],
};

describe("runRecommendationPipeline (offline)", () => {
  it("produces a valid, fully-checked recommendation", async () => {
    const rec = await runRecommendationPipeline(validProfile);

    // allocation invariant
    const a = rec.allocation;
    expect(a.stocks + a.bonds + a.cash + a.alternatives).toBe(100);

    // every pick carries a rationale
    expect(rec.picks.length).toBeGreaterThan(0);
    expect(rec.picks.every((p) => p.rationale.trim().length > 0)).toBe(true);

    // meta + audit trail
    expect(rec.meta.reasoningSource).toBe("rule_based");
    expect(rec.meta.dataSource).toBe("fallback");
    expect(rec.meta.traceId).toMatch(/^trc_/);
    expect(rec.meta.checks.length).toBeGreaterThan(0);

    // the deterministic gates (profile/allocation/market) all pass offline
    const deterministic = rec.meta.checks.filter((c) =>
      ["profile", "allocate", "market_data"].includes(c.stage),
    );
    expect(deterministic.every((c) => c.passed)).toBe(true);

    expect(rec.disclaimers.length).toBeGreaterThan(0);
  });

  it("rejects an invalid profile with a PipelineError", async () => {
    await expect(
      runRecommendationPipeline({ ...validProfile, age: 5 }),
    ).rejects.toBeInstanceOf(PipelineError);
  });

  it("rejects a contradictory profile (short-term + long horizon)", async () => {
    await expect(
      runRecommendationPipeline({
        ...validProfile,
        goal: "short_term",
        horizonYears: 20,
      }),
    ).rejects.toBeInstanceOf(PipelineError);
  });
});
