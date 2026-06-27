import { describe, it, expect } from "vitest";
import {
  project,
  expectedReturn,
  scenarios,
  requiredMonthlyContribution,
  ASSUMED_RETURNS,
} from "@/lib/project";
import type { Allocation } from "@/lib/types";

describe("expectedReturn", () => {
  it("blends asset-class assumptions by weight", () => {
    const alloc: Allocation = { stocks: 100, bonds: 0, cash: 0, alternatives: 0 };
    expect(expectedReturn(alloc)).toBeCloseTo(ASSUMED_RETURNS.stocks, 10);
  });

  it("weights a mixed allocation", () => {
    const alloc: Allocation = { stocks: 60, bonds: 30, cash: 10, alternatives: 0 };
    // 0.6*0.07 + 0.3*0.03 + 0.1*0.015 = 0.042 + 0.009 + 0.0015 = 0.0525
    expect(expectedReturn(alloc)).toBeCloseTo(0.0525, 10);
  });
});

describe("project", () => {
  it("with no growth, balance equals total contributions", () => {
    const p = project({ startingBalance: 0, monthlyContribution: 100, years: 1, annualReturn: 0 });
    expect(p.finalBalance).toBe(1200);
    expect(p.totalContributed).toBe(1200);
    expect(p.growth).toBe(0);
  });

  it("compounds a lump sum to exactly the annual return over 12 months", () => {
    const p = project({ startingBalance: 1000, monthlyContribution: 0, years: 1, annualReturn: 0.12 });
    expect(p.finalBalance).toBe(1120); // 1000 * 1.12
    expect(p.growth).toBe(120);
  });

  it("snapshots one point per year plus year zero", () => {
    const p = project({ startingBalance: 500, monthlyContribution: 50, years: 5, annualReturn: 0.06 });
    expect(p.points).toHaveLength(6);
    expect(p.points[0]).toEqual({ year: 0, balance: 500, invested: 500 });
    expect(p.points.at(-1)!.year).toBe(5);
  });

  it("balance exceeds invested once returns are positive", () => {
    const p = project({ startingBalance: 1000, monthlyContribution: 200, years: 10, annualReturn: 0.07 });
    expect(p.finalBalance).toBeGreaterThan(p.totalContributed + 1000);
    expect(p.growth).toBeGreaterThan(0);
  });

  it("floors negative inputs", () => {
    const p = project({ startingBalance: -100, monthlyContribution: -50, years: -3, annualReturn: 0.05 });
    expect(p.finalBalance).toBe(0);
    expect(p.points).toHaveLength(1); // just year 0
  });
});

describe("requiredMonthlyContribution", () => {
  it("returns a monthly that, fed back into project(), reaches the goal", () => {
    const goal = 500_000;
    const pmt = requiredMonthlyContribution(goal, 10_000, 30, 0.06);
    const reached = project({
      startingBalance: 10_000,
      monthlyContribution: pmt,
      years: 30,
      annualReturn: 0.06,
    }).finalBalance;
    expect(reached).toBeGreaterThanOrEqual(goal);
    // ...and not wildly over (within one month's contribution of the goal).
    expect(reached).toBeLessThan(goal + pmt * 13);
  });

  it("returns 0 when the starting balance already compounds past the goal", () => {
    expect(requiredMonthlyContribution(50_000, 100_000, 20, 0.05)).toBe(0);
  });

  it("handles a zero return (linear funding)", () => {
    // Need 12000 over 1 year, no growth -> 1000/mo.
    expect(requiredMonthlyContribution(12_000, 0, 1, 0)).toBe(1000);
  });

  it("returns 0 with no horizon", () => {
    expect(requiredMonthlyContribution(10_000, 0, 0, 0.05)).toBe(0);
  });
});

describe("scenarios", () => {
  it("orders conservative <= expected <= optimistic", () => {
    const s = scenarios(
      { startingBalance: 1000, monthlyContribution: 100, years: 20 },
      0.06,
    );
    expect(s.conservative.finalBalance).toBeLessThanOrEqual(s.expected.finalBalance);
    expect(s.expected.finalBalance).toBeLessThanOrEqual(s.optimistic.finalBalance);
  });

  it("never uses a negative return for the conservative case", () => {
    const s = scenarios({ startingBalance: 1000, monthlyContribution: 0, years: 1 }, 0.01);
    // expected - 0.02 would be negative; floored to 0 -> balance stays at start.
    expect(s.conservative.finalBalance).toBe(1000);
  });
});
