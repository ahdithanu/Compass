// Pure rebalancing math: given what you hold now and the target allocation,
// work out the trades that close the gap. No React/DB so it's easy to test.

import type { Allocation } from "./types";

export type Bucket = keyof Allocation;

export const BUCKETS: Bucket[] = ["stocks", "bonds", "cash", "alternatives"];

export interface RebalanceRow {
  bucket: Bucket;
  /** Current dollar value held in this bucket. */
  current: number;
  /** Current share of the portfolio, whole percent. */
  currentPct: number;
  /** Target share, whole percent (straight from the allocation). */
  targetPct: number;
  /** Dollar value this bucket should hold at the target. */
  target: number;
  /** target - current. Positive = buy, negative = sell. */
  delta: number;
}

export interface RebalancePlan {
  total: number;
  rows: RebalanceRow[];
  /** Half the summed absolute drift in points — the share of the book that
   *  must move to reach target (standard turnover measure). */
  driftPct: number;
  /** True when every bucket is within `tolerancePts` of its target. */
  balanced: boolean;
}

/**
 * Compare current holdings to a target allocation and return per-bucket trades.
 * `tolerancePts` is the drift (in percentage points) a bucket may have before
 * it's flagged as needing a trade.
 */
export function computeRebalance(
  current: Record<Bucket, number>,
  target: Allocation,
  tolerancePts = 1,
): RebalancePlan {
  // Negative inputs are nonsense for holdings — floor them at zero.
  const safe = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  const held: Record<Bucket, number> = {
    stocks: safe(current.stocks),
    bonds: safe(current.bonds),
    cash: safe(current.cash),
    alternatives: safe(current.alternatives),
  };
  const total = BUCKETS.reduce((sum, b) => sum + held[b], 0);

  let driftRaw = 0;
  let balanced = true;
  const rows: RebalanceRow[] = BUCKETS.map((bucket) => {
    const value = held[bucket];
    const currentPctRaw = total > 0 ? (value / total) * 100 : 0;
    const targetPct = target[bucket] ?? 0;
    const targetValue = (total * targetPct) / 100;

    const gap = Math.abs(currentPctRaw - targetPct);
    driftRaw += gap;
    // Epsilon guards against float noise (e.g. 6100/10000*100 = 61.0000…001).
    if (gap > tolerancePts + 1e-9) balanced = false;

    return {
      bucket,
      current: value,
      currentPct: Math.round(currentPctRaw),
      targetPct,
      target: Math.round(targetValue),
      delta: Math.round(targetValue - value),
    };
  });

  return {
    total,
    rows,
    driftPct: Math.round(driftRaw / 2),
    // With no money in, "balanced" is meaningless — call it unbalanced.
    balanced: total > 0 && balanced,
  };
}
