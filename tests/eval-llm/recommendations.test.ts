// LLM-judge recommendation evals — the quality layer. Runs the pipeline WITH
// Claude over a cost-bounded subset, then grades each output with an
// independent Claude judge, prints a scorecard, and asserts thresholds.
//
// NOT part of `npm test` (excluded from the default config): it costs money and
// is non-deterministic. Run on demand / nightly with `npm run eval` (uses
// vitest.evals.config.ts, which does NOT load the hermetic setup, so the real
// ANTHROPIC_API_KEY flows through). Self-skips when the key is absent.

import { describe, it, expect, afterAll } from "vitest";
import { CASES, LLM_SUBSET_IDS } from "../../evals/cases";
import { checkRecommendation } from "../../evals/invariants";
import { judgeRecommendation, type JudgeVerdict } from "../../evals/judge";
import { runRecommendationPipeline } from "@/lib/pipeline";
import { buildAllocation, selectCandidates } from "@/lib/allocate";

const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY);
const SUBSET = CASES.filter((c) => LLM_SUBSET_IDS.includes(c.id));

describe.runIf(HAS_KEY)("recommendation evals — LLM judge (needs ANTHROPIC_API_KEY)", () => {
  const scorecard: Array<{ case: string } & JudgeVerdict> = [];

  afterAll(() => {
    if (scorecard.length === 0) return;
    const avg = (k: keyof JudgeVerdict) =>
      (scorecard.reduce((s, r) => s + (r[k] as number), 0) / scorecard.length).toFixed(2);
    const passRate = scorecard.filter((r) => r.overall === "pass").length / scorecard.length;
    // eslint-disable-next-line no-console
    console.log(
      `\n=== LLM eval scorecard (${scorecard.length} cases) ===\n` +
        `overall pass: ${(passRate * 100).toFixed(0)}%  |  ` +
        `groundedness ${avg("groundedness")}  suitability ${avg("suitability")}  ` +
        `tone ${avg("tone")}  completeness ${avg("completeness")}`,
    );
    // eslint-disable-next-line no-console
    console.table(scorecard.map((r) => ({ ...r, issues: r.issues.join("; ") })));
  });

  for (const c of SUBSET) {
    it(
      `${c.id}: Claude output is grounded, suitable, and compliant`,
      async () => {
        const rec = await runRecommendationPipeline(c.profile, {
          allowLlm: true,
          allowLiveData: false, // sample market data -> the judge grades reasoning, not data variance
        });
        expect(rec.meta.reasoningSource).toBe("claude");

        const candidates = selectCandidates(c.profile, buildAllocation(c.profile));
        // Structural floor must hold even for Claude output.
        const structural = checkRecommendation(rec, candidates.map((x) => x.ticker), c.bounds);
        expect(structural.failures.join("; ")).toBe("");

        const verdict = await judgeRecommendation(c.profile, rec, candidates);
        expect(verdict).not.toBeNull();
        scorecard.push({ case: c.id, ...verdict! });

        // Hard gates: groundedness and suitability are non-negotiable.
        expect(verdict!.groundedness, verdict!.issues.join("; ")).toBeGreaterThanOrEqual(4);
        expect(verdict!.suitability, verdict!.issues.join("; ")).toBeGreaterThanOrEqual(4);
        expect(verdict!.overall, verdict!.issues.join("; ")).toBe("pass");
      },
      120_000,
    );
  }
});
