// Pure diff between two recommendation runs. Powers the "what changed since
// last time" comparison view. Kept free of React/DB so it's trivially testable.

import type { Allocation, Recommendation } from "./types";

export type AllocationKey = keyof Allocation;

export interface AllocationDelta {
  key: AllocationKey;
  /** Allocation in the older (baseline) run. */
  from: number;
  /** Allocation in the newer (current) run. */
  to: number;
  /** to - from: positive means the newer plan leans into this bucket. */
  delta: number;
}

export interface PickChange {
  ticker: string;
  name: string;
  bucket: string;
}

export interface RunComparison {
  allocation: AllocationDelta[];
  /** Tickers in the newer run but not the older one. */
  added: PickChange[];
  /** Tickers in the older run but not the newer one. */
  removed: PickChange[];
  /** Tickers present in both. */
  held: PickChange[];
  /** True when nothing moved — same mix, same names. */
  unchanged: boolean;
}

const KEYS: AllocationKey[] = ["stocks", "bonds", "cash", "alternatives"];

/**
 * Diff two recommendations. `from` is the older baseline, `to` is the newer
 * plan; deltas read as "how the newer plan changed relative to the older one".
 */
export function diffRuns(
  from: Recommendation,
  to: Recommendation,
): RunComparison {
  const allocation: AllocationDelta[] = KEYS.map((key) => {
    const a = from.allocation[key] ?? 0;
    const b = to.allocation[key] ?? 0;
    return { key, from: a, to: b, delta: b - a };
  });

  const fromMap = new Map(from.picks.map((p) => [p.ticker, p]));
  const toMap = new Map(to.picks.map((p) => [p.ticker, p]));

  const added: PickChange[] = [];
  const held: PickChange[] = [];
  for (const p of to.picks) {
    const change = { ticker: p.ticker, name: p.name, bucket: p.bucket };
    if (fromMap.has(p.ticker)) held.push(change);
    else added.push(change);
  }

  const removed: PickChange[] = from.picks
    .filter((p) => !toMap.has(p.ticker))
    .map((p) => ({ ticker: p.ticker, name: p.name, bucket: p.bucket }));

  const allocationMoved = allocation.some((d) => d.delta !== 0);
  const unchanged = !allocationMoved && added.length === 0 && removed.length === 0;

  return { allocation, added, removed, held, unchanged };
}
