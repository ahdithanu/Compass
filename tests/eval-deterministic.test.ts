// Deterministic recommendation evals — the regression net. Runs the pipeline in
// rule-based mode (allowLlm/allowLiveData false), so it's fully deterministic,
// needs no API key, and runs in the normal suite + CI. Asserts structural and
// suitability invariants per golden-set profile, plus equity-exposure
// monotonicity across the single-dimension groups.

import { describe, it, expect } from "vitest";
import { CASES, MONOTONIC_GROUPS } from "../evals/cases";
import { checkRecommendation, stocksStrictlyAscending } from "../evals/invariants";
import { runRecommendationPipeline } from "@/lib/pipeline";
import { buildAllocation, selectCandidates } from "@/lib/allocate";

describe("recommendation evals — deterministic (rule-based, hermetic)", () => {
  for (const c of CASES) {
    it(`${c.id}: ${c.description}`, async () => {
      const rec = await runRecommendationPipeline(c.profile, {
        allowLlm: false,
        allowLiveData: false,
      });
      // Rule-based path only — no key, no network.
      expect(rec.meta.reasoningSource).toBe("rule_based");

      const candidates = selectCandidates(c.profile, buildAllocation(c.profile)).map((x) => x.ticker);
      const result = checkRecommendation(rec, candidates, c.bounds);
      expect(result.failures.join("; ")).toBe("");
    });
  }

  for (const group of MONOTONIC_GROUPS) {
    it(`monotonicity — ${group.description}`, () => {
      const stocks = group.profiles.map((p) => buildAllocation(p).stocks);
      const result = stocksStrictlyAscending(stocks);
      expect(result.failures.join("; ")).toBe("");
    });
  }
});
