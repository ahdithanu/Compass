// Pure growth-projection math for the "are you on track?" forecaster. Compounds
// a starting balance plus monthly contributions at an assumed annual return and
// snapshots the balance each year. No React/DB — trivially testable.

import type { Allocation } from "./types";

/** Long-run nominal return assumptions by asset class (educational, not advice). */
export const ASSUMED_RETURNS: Record<keyof Allocation, number> = {
  stocks: 0.07,
  bonds: 0.03,
  cash: 0.015,
  alternatives: 0.05,
};

/** Blended expected annual return (decimal) for an allocation's mix. */
export function expectedReturn(alloc: Allocation): number {
  const keys = Object.keys(ASSUMED_RETURNS) as (keyof Allocation)[];
  const weighted = keys.reduce(
    (sum, k) => sum + ((alloc[k] ?? 0) / 100) * ASSUMED_RETURNS[k],
    0,
  );
  return weighted;
}

export interface ProjectionInput {
  startingBalance: number;
  monthlyContribution: number;
  years: number;
  /** Nominal annual return, decimal (e.g. 0.06 for 6%). */
  annualReturn: number;
}

export interface ProjectionPoint {
  year: number;
  /** Projected balance at the end of this year. */
  balance: number;
  /** Cumulative out-of-pocket: starting balance + contributions so far. */
  invested: number;
}

export interface Projection {
  points: ProjectionPoint[];
  finalBalance: number;
  totalContributed: number;
  /** finalBalance - startingBalance - totalContributed (compounding gains). */
  growth: number;
}

/**
 * Project growth with monthly compounding and end-of-month contributions. The
 * monthly rate is derived so that 12 months compounds to exactly `annualReturn`.
 */
export function project(input: ProjectionInput): Projection {
  const start = Math.max(0, input.startingBalance || 0);
  const monthly = Math.max(0, input.monthlyContribution || 0);
  const years = Math.max(0, Math.floor(input.years || 0));
  const annual = input.annualReturn || 0;

  const monthlyRate = Math.pow(1 + annual, 1 / 12) - 1;

  const points: ProjectionPoint[] = [{ year: 0, balance: start, invested: start }];
  let balance = start;

  for (let y = 1; y <= years; y++) {
    for (let m = 0; m < 12; m++) {
      balance = balance * (1 + monthlyRate) + monthly;
    }
    const invested = start + monthly * 12 * y;
    points.push({
      year: y,
      balance: Math.round(balance),
      invested: Math.round(invested),
    });
  }

  const totalContributed = monthly * 12 * years;
  const finalBalance = Math.round(balance);
  return {
    points,
    finalBalance,
    totalContributed: Math.round(totalContributed),
    growth: Math.round(finalBalance - start - totalContributed),
  };
}

/**
 * Solve for the monthly contribution needed to reach `goal` by the horizon —
 * the actionable answer to "I'm short, what would it take?". Inverts the same
 * ordinary-annuity model `project` uses, so feeding the result back into
 * project() lands on (or just above) the goal. Returns 0 when the starting
 * balance already compounds past the goal. Rounds up so you don't fall short.
 */
export function requiredMonthlyContribution(
  goal: number,
  startingBalance: number,
  years: number,
  annualReturn: number,
): number {
  const start = Math.max(0, startingBalance || 0);
  const months = Math.max(0, Math.floor(years || 0)) * 12;
  if (months === 0) return 0; // no horizon to contribute over

  const r = Math.pow(1 + (annualReturn || 0), 1 / 12) - 1;
  const factor = Math.pow(1 + r, months);
  const fromStart = start * factor; // what the lump sum alone grows to

  if (fromStart >= goal) return 0; // already there without adding a cent

  // PMT = (goal - start·factor) / annuityFactor
  const annuityFactor = r === 0 ? months : (factor - 1) / r;
  const pmt = (goal - fromStart) / annuityFactor;
  return Math.max(0, Math.ceil(pmt));
}

/** Three scenarios around the expected return: a ±2pt band, floored at 0. */
export function scenarios(
  base: Omit<ProjectionInput, "annualReturn">,
  expected: number,
  band = 0.02,
): { conservative: Projection; expected: Projection; optimistic: Projection } {
  return {
    conservative: project({ ...base, annualReturn: Math.max(0, expected - band) }),
    expected: project({ ...base, annualReturn: expected }),
    optimistic: project({ ...base, annualReturn: expected + band }),
  };
}
