# Evals

Two layers of automated evaluation for the recommendation pipeline.

## 1. Deterministic evals — the regression net (CI gate)

`tests/eval-deterministic.test.ts`, run by the normal suite:

```bash
npm test
```

Runs the pipeline in **rule-based** mode (`allowLlm: false`) over the golden
set in `evals/cases.ts`, asserting invariants from `evals/invariants.ts`:

- allocation sums to 100 and every sleeve is in `[0, 100]`
- picks are non-empty, come only from the candidate set (no invented tickers),
  and each has a rationale
- disclaimers / summary / "the move" are present; the profile + allocation
  checker gates passed
- per-profile **suitability bounds** (e.g. a conservative 3-year saver stays
  near cash; a young aggressive investor is equity-heavy)
- **monotonicity**: equity exposure strictly rises with risk tolerance, with
  horizon, and from short-term → growth goals

No API key, no network — deterministic, so it gates merges in CI.

## 2. LLM-judge evals — the quality layer (paid, manual/nightly)

`tests/eval-llm/recommendations.test.ts`, run on demand:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run eval
```

Runs the pipeline **with Claude** over a cost-bounded subset, then grades each
output with an independent Claude judge (`evals/judge.ts`) on groundedness,
suitability, tone/compliance, and completeness. Prints a scorecard and asserts
hard gates (groundedness ≥ 4, suitability ≥ 4, overall pass).

- Uses `vitest.evals.config.ts`, which does **not** load the hermetic
  `tests/setup.ts`, so the real key flows through.
- **Self-skips** when `ANTHROPIC_API_KEY` is absent — safe to wire into CI
  without a secret; it becomes a no-op until the secret is set.
- Excluded from `npm test` (it costs money and is non-deterministic).

The nightly workflow `.github/workflows/evals.yml` runs it on a schedule and on
manual dispatch; add the `ANTHROPIC_API_KEY` repo secret to activate it.

## Adding a case

Add an `EvalCase` to `CASES` in `evals/cases.ts` (with optional `bounds`). Both
layers pick it up automatically; add its id to `LLM_SUBSET_IDS` to include it in
the paid layer. For a new ordering guarantee, add a `MONOTONIC_GROUPS` entry.
