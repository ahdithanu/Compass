// Golden set for the recommendation evals. A curated spread of user profiles
// across age / risk / horizon / goal, each with loose suitability bounds that
// must hold, plus monotonicity groups where exactly one dimension varies so the
// ordering of equity exposure can be asserted. Deterministic evals assert these
// on the rule-based pipeline (no key); LLM-judge evals grade the Claude-written
// version of the same set.

import type { Goal, JourneyStage, Profile, RiskTolerance } from "@/lib/types";

export interface SuitabilityBounds {
  /** Equity % must not exceed this (unsuitably aggressive). */
  maxStocks?: number;
  /** Equity % must be at least this (unsuitably timid for the profile). */
  minStocks?: number;
  /** cash + bonds must be at least this (safety sleeve for short/defensive). */
  minCashBonds?: number;
}

export interface EvalCase {
  id: string;
  description: string;
  profile: Profile;
  bounds?: SuitabilityBounds;
}

function p(
  fields: Pick<Profile, "age" | "goal" | "riskTolerance" | "horizonYears" | "journeyStage"> &
    Partial<Profile>,
): Profile {
  return { interests: [], ...fields };
}

export const CASES: EvalCase[] = [
  {
    id: "young_aggressive_growth",
    description: "25, growth, aggressive, 40y — should be equity-heavy",
    profile: p({ age: 25, goal: "growth", riskTolerance: "aggressive", horizonYears: 40, journeyStage: "building" }),
    bounds: { minStocks: 70 },
  },
  {
    id: "young_moderate",
    description: "25, growth, moderate, 40y",
    profile: p({ age: 25, goal: "growth", riskTolerance: "moderate", horizonYears: 40, journeyStage: "building" }),
    bounds: { minStocks: 60 },
  },
  {
    id: "mid_conservative",
    description: "45, retirement, conservative, 20y",
    profile: p({ age: 45, goal: "retirement", riskTolerance: "conservative", horizonYears: 20, journeyStage: "established" }),
    bounds: { maxStocks: 72 },
  },
  {
    id: "near_retirement_preservation",
    description: "62, preservation, conservative, 5y — capital protection",
    profile: p({ age: 62, goal: "preservation", riskTolerance: "conservative", horizonYears: 5, journeyStage: "nearing_goal" }),
    bounds: { maxStocks: 40, minCashBonds: 55 },
  },
  {
    id: "short_term_saver",
    description: "35, short_term, conservative, 3y — near-cash",
    profile: p({ age: 35, goal: "short_term", riskTolerance: "conservative", horizonYears: 3, journeyStage: "building" }),
    bounds: { maxStocks: 50, minCashBonds: 45 },
  },
  {
    id: "income_seeker",
    description: "55, income, moderate, 15y",
    profile: p({ age: 55, goal: "income", riskTolerance: "moderate", horizonYears: 15, journeyStage: "established" }),
    bounds: { maxStocks: 70 },
  },
  {
    id: "just_starting_young",
    description: "22, growth, moderate, 43y, just starting",
    profile: p({ age: 22, goal: "growth", riskTolerance: "moderate", horizonYears: 43, journeyStage: "just_starting" }),
    bounds: { minStocks: 60 },
  },
  {
    id: "aggressive_long",
    description: "30, growth, aggressive, 35y — max equity intent",
    profile: p({ age: 30, goal: "growth", riskTolerance: "aggressive", horizonYears: 35, journeyStage: "building" }),
    bounds: { minStocks: 70 },
  },
  {
    id: "conservative_long",
    description: "30, retirement, conservative, 35y",
    profile: p({ age: 30, goal: "retirement", riskTolerance: "conservative", horizonYears: 35, journeyStage: "building" }),
    bounds: { maxStocks: 85 },
  },
  {
    id: "moderate_mid",
    description: "40, retirement, moderate, 25y",
    profile: p({ age: 40, goal: "retirement", riskTolerance: "moderate", horizonYears: 25, journeyStage: "established" }),
    bounds: { minStocks: 60, maxStocks: 92 },
  },
  {
    id: "old_aggressive_edge",
    description: "70, growth, aggressive, 15y — glide-path vs risk clamps",
    profile: p({ age: 70, goal: "growth", riskTolerance: "aggressive", horizonYears: 15, journeyStage: "nearing_goal" }),
    bounds: { minStocks: 45 },
  },
  {
    id: "with_interests",
    description: "28, growth, aggressive, 30y, interests: AI + clean energy",
    profile: p({
      age: 28, goal: "growth", riskTolerance: "aggressive", horizonYears: 30, journeyStage: "building",
      interests: ["AI", "clean energy"],
    }),
    bounds: { minStocks: 65 },
  },
];

/** Profiles that differ in exactly one dimension; equity % must strictly rise. */
export interface MonotonicGroup {
  id: string;
  description: string;
  /** Ordered so that equity exposure should strictly increase down the list. */
  profiles: Profile[];
}

export const MONOTONIC_GROUPS: MonotonicGroup[] = [
  {
    id: "risk",
    description: "stocks rise with risk tolerance (conservative < moderate < aggressive)",
    profiles: (["conservative", "moderate", "aggressive"] as RiskTolerance[]).map((riskTolerance) =>
      p({ age: 45, goal: "retirement", riskTolerance, horizonYears: 20, journeyStage: "established" }),
    ),
  },
  {
    id: "horizon",
    description: "stocks rise with horizon (3y < 7y < 35y)",
    profiles: [3, 7, 35].map((horizonYears) =>
      p({ age: 30, goal: "growth", riskTolerance: "aggressive", horizonYears, journeyStage: "building" }),
    ),
  },
  {
    id: "goal",
    description: "stocks rise from short-term to growth (short_term < retirement < growth)",
    profiles: (["short_term", "retirement", "growth"] as Goal[]).map((goal) =>
      p({ age: 35, goal, riskTolerance: "moderate", horizonYears: 10, journeyStage: "building" }),
    ),
  },
];

/** Cost-bounded subset for the paid LLM-judge layer. */
export const LLM_SUBSET_IDS = [
  "young_aggressive_growth",
  "near_retirement_preservation",
  "short_term_saver",
  "income_seeker",
  "with_interests",
];
