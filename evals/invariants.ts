// Pure invariant checks over a recommendation. Shared by the deterministic eval
// suite (asserted directly) and available to the LLM-judge layer as the
// structural floor beneath the model-graded quality dimensions.

import type { Recommendation } from "@/lib/types";
import type { SuitabilityBounds } from "./cases";

export interface EvalResult {
  pass: boolean;
  failures: string[];
}

/**
 * Structural + suitability invariants that must hold for every recommendation,
 * regardless of whether the rationale was written by Claude or the rule-based
 * fallback. `candidateTickers` is the set the picks are allowed to come from
 * (no invented tickers).
 */
export function checkRecommendation(
  rec: Recommendation,
  candidateTickers: string[],
  bounds?: SuitabilityBounds,
): EvalResult {
  const f: string[] = [];
  const a = rec.allocation;

  const sum = a.stocks + a.bonds + a.cash + a.alternatives;
  if (Math.abs(sum - 100) > 1) f.push(`allocation sums to ${sum}, not 100`);
  for (const [k, v] of Object.entries(a)) {
    if (v < 0 || v > 100) f.push(`allocation.${k}=${v} outside [0,100]`);
  }

  if (rec.picks.length === 0) f.push("no picks produced");
  const allowed = new Set(candidateTickers);
  for (const pick of rec.picks) {
    if (!allowed.has(pick.ticker)) f.push(`pick "${pick.ticker}" is not in the candidate set (invented)`);
    if (!pick.rationale?.trim()) f.push(`pick "${pick.ticker}" has an empty rationale`);
  }

  if (!rec.disclaimers?.length) f.push("no disclaimers");
  if (!rec.summary?.trim()) f.push("empty summary");
  if (!rec.theMove?.headline?.trim() || !rec.theMove?.reasoning?.trim()) {
    f.push("empty theMove headline/reasoning");
  }

  // Deterministic checker gates must have passed.
  for (const c of rec.meta.checks) {
    if ((c.stage === "profile" || c.stage === "allocate") && !c.passed) {
      f.push(`gate failed: ${c.stage}/${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
  }

  // Suitability bounds (per case).
  if (bounds?.maxStocks != null && a.stocks > bounds.maxStocks) {
    f.push(`stocks ${a.stocks}% exceeds suitable max ${bounds.maxStocks}%`);
  }
  if (bounds?.minStocks != null && a.stocks < bounds.minStocks) {
    f.push(`stocks ${a.stocks}% below suitable min ${bounds.minStocks}%`);
  }
  if (bounds?.minCashBonds != null && a.cash + a.bonds < bounds.minCashBonds) {
    f.push(`cash+bonds ${a.cash + a.bonds}% below safety floor ${bounds.minCashBonds}%`);
  }

  return { pass: f.length === 0, failures: f };
}

/** Assert equity % strictly increases across an ordered list of allocations. */
export function stocksStrictlyAscending(stocks: number[]): EvalResult {
  const f: string[] = [];
  for (let i = 1; i < stocks.length; i++) {
    if (!(stocks[i] > stocks[i - 1])) {
      f.push(`stocks not strictly increasing at index ${i}: ${stocks[i - 1]} -> ${stocks[i]}`);
    }
  }
  return { pass: f.length === 0, failures: f };
}
