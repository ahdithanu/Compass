import { describe, it, expect } from "vitest";
import { computeRebalance } from "@/lib/rebalance";
import type { Allocation } from "@/lib/types";

const target: Allocation = { stocks: 60, bonds: 30, cash: 10, alternatives: 0 };

function rows(plan: ReturnType<typeof computeRebalance>) {
  return Object.fromEntries(plan.rows.map((r) => [r.bucket, r]));
}

describe("computeRebalance", () => {
  it("computes per-bucket trades to reach the target", () => {
    // $10k all in stocks; target 60/30/10.
    const plan = computeRebalance(
      { stocks: 10000, bonds: 0, cash: 0, alternatives: 0 },
      target,
    );
    expect(plan.total).toBe(10000);
    const r = rows(plan);
    expect(r.stocks.delta).toBe(-4000); // sell 4k of stocks
    expect(r.bonds.delta).toBe(3000); // buy 3k bonds
    expect(r.cash.delta).toBe(1000); // buy 1k cash
  });

  it("reports drift as the share of the book that must move", () => {
    const plan = computeRebalance(
      { stocks: 10000, bonds: 0, cash: 0, alternatives: 0 },
      target,
    );
    // |100-60| + |0-30| + |0-10| = 80; half = 40%.
    expect(plan.driftPct).toBe(40);
    expect(plan.balanced).toBe(false);
  });

  it("flags an already-balanced portfolio (within tolerance)", () => {
    const plan = computeRebalance(
      { stocks: 6000, bonds: 3000, cash: 1000, alternatives: 0 },
      target,
    );
    expect(plan.balanced).toBe(true);
    expect(plan.driftPct).toBe(0);
    expect(plan.rows.every((r) => Math.abs(r.delta) <= 1)).toBe(true);
  });

  it("respects the tolerance band", () => {
    // 61/29/10 — 1pt off on two buckets; within default 1pt tolerance.
    const plan = computeRebalance(
      { stocks: 6100, bonds: 2900, cash: 1000, alternatives: 0 },
      target,
    );
    expect(plan.balanced).toBe(true);
  });

  it("treats an empty portfolio as unbalanced with zero total", () => {
    const plan = computeRebalance(
      { stocks: 0, bonds: 0, cash: 0, alternatives: 0 },
      target,
    );
    expect(plan.total).toBe(0);
    expect(plan.balanced).toBe(false);
  });

  it("floors negative/garbage inputs at zero", () => {
    const plan = computeRebalance(
      { stocks: -500, bonds: NaN, cash: 1000, alternatives: 0 },
      target,
    );
    expect(plan.total).toBe(1000);
    const r = rows(plan);
    expect(r.stocks.current).toBe(0);
    expect(r.bonds.current).toBe(0);
  });
});
