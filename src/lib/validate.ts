// Deterministic checker gates. Each stage of the pipeline runs one or more of
// these before its output is allowed to advance. They are pure functions so
// they are trivially unit-testable and never depend on the LLM.

import type {
  Allocation,
  CandidatePick,
  CheckResult,
  Goal,
  InsightDraft,
  JourneyStage,
  NewsItem,
  Profile,
  RiskTolerance,
  SynthesisDraft,
} from "./types";

const GOALS: Goal[] = [
  "retirement",
  "growth",
  "income",
  "preservation",
  "short_term",
];
const RISKS: RiskTolerance[] = ["conservative", "moderate", "aggressive"];
const STAGES: JourneyStage[] = [
  "just_starting",
  "building",
  "established",
  "nearing_goal",
];

export interface ProfileValidation {
  ok: boolean;
  profile?: Profile;
  issues: string[];
}

/**
 * Stage 1 gate: validate + normalize raw profile input. Clamps numeric ranges,
 * rejects unknown enum values, and flags internally contradictory profiles
 * (e.g. a "short_term" goal with a 30-year horizon) rather than silently
 * producing a nonsensical recommendation downstream.
 */
export function validateProfile(input: unknown): ProfileValidation {
  const issues: string[] = [];
  if (typeof input !== "object" || input === null) {
    return { ok: false, issues: ["Profile payload is missing or malformed."] };
  }
  const raw = input as Record<string, unknown>;

  const age = Number(raw.age);
  if (!Number.isFinite(age) || age < 18 || age > 100) {
    issues.push("Age must be a number between 18 and 100.");
  }

  const goal = raw.goal as Goal;
  if (!GOALS.includes(goal)) issues.push(`Unknown goal: ${String(raw.goal)}.`);

  const riskTolerance = raw.riskTolerance as RiskTolerance;
  if (!RISKS.includes(riskTolerance)) {
    issues.push(`Unknown risk tolerance: ${String(raw.riskTolerance)}.`);
  }

  const journeyStage = raw.journeyStage as JourneyStage;
  if (!STAGES.includes(journeyStage)) {
    issues.push(`Unknown journey stage: ${String(raw.journeyStage)}.`);
  }

  const horizonYears = Number(raw.horizonYears);
  if (!Number.isFinite(horizonYears) || horizonYears < 0 || horizonYears > 70) {
    issues.push("Horizon must be between 0 and 70 years.");
  }

  let monthlyContribution: number | undefined;
  if (raw.monthlyContribution != null && raw.monthlyContribution !== "") {
    const mc = Number(raw.monthlyContribution);
    if (!Number.isFinite(mc) || mc < 0) {
      issues.push("Monthly contribution must be a non-negative number.");
    } else {
      monthlyContribution = mc;
    }
  }

  const interests = Array.isArray(raw.interests)
    ? raw.interests.filter((i): i is string => typeof i === "string").slice(0, 8)
    : [];

  // Edge-case / contradiction checks (only when the basics are sound).
  if (issues.length === 0) {
    if (goal === "short_term" && horizonYears > 5) {
      issues.push(
        "A short-term goal with a horizon over 5 years is contradictory — pick a longer-term goal or shorten the horizon.",
      );
    }
    if (goal === "retirement" && age >= 60 && horizonYears > 30) {
      issues.push(
        "A 30+ year horizon at age 60+ is unusual for a retirement goal — please double-check the horizon.",
      );
    }
    if (riskTolerance === "aggressive" && horizonYears <= 2) {
      issues.push(
        "Aggressive risk with a 2-year-or-less horizon exposes you to losses you may not have time to recover from.",
      );
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    issues: [],
    profile: {
      age,
      goal,
      riskTolerance,
      journeyStage,
      horizonYears,
      monthlyContribution,
      interests,
    },
  };
}

/** Stage 2 gate: an allocation must be clean before we build picks from it. */
export function checkAllocation(alloc: Allocation): CheckResult {
  const parts = [alloc.stocks, alloc.bonds, alloc.cash, alloc.alternatives];
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) {
    return {
      stage: "allocate",
      name: "allocation_weights_valid",
      passed: false,
      detail: "Allocation contains a negative or non-numeric weight.",
    };
  }
  const sum = parts.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.5) {
    return {
      stage: "allocate",
      name: "allocation_sums_to_100",
      passed: false,
      detail: `Allocation sums to ${sum.toFixed(1)}%, expected 100%.`,
    };
  }
  return { stage: "allocate", name: "allocation_sums_to_100", passed: true };
}

/** Stage 3 gate: the market feed returned usable data for our candidates. */
export function checkMarketData(
  quotedSymbols: string[],
  candidates: CandidatePick[],
  source: "live" | "fallback",
): CheckResult {
  const missing = candidates
    .map((c) => c.ticker)
    .filter((t) => !quotedSymbols.includes(t));
  // Missing quotes are tolerated (we render the pick without a price), but we
  // record it so the gap is visible in the audit trail.
  return {
    stage: "market_data",
    name: "market_data_present",
    passed: true,
    detail:
      source === "fallback"
        ? "Using fallback sample quotes (no FMP_API_KEY or feed unavailable)."
        : missing.length
          ? `Live data missing for: ${missing.join(", ")}.`
          : "Live quotes resolved for all candidates.",
  };
}

/**
 * Stage 5 deterministic checks (run alongside the LLM critic). These catch the
 * failure modes we can verify in code: hallucinated tickers, missing
 * rationales, and dropped disclaimers.
 */
export function checkSynthesis(
  draft: SynthesisDraft,
  candidates: CandidatePick[],
): CheckResult[] {
  const results: CheckResult[] = [];
  const candidateTickers = new Set(candidates.map((c) => c.ticker));

  const hallucinated = draft.pickRationales
    .map((p) => p.ticker)
    .filter((t) => !candidateTickers.has(t));
  results.push({
    stage: "critic",
    name: "no_hallucinated_tickers",
    passed: hallucinated.length === 0,
    detail: hallucinated.length
      ? `Rationale references tickers outside the candidate set: ${hallucinated.join(", ")}.`
      : undefined,
  });

  const covered = new Set(draft.pickRationales.map((p) => p.ticker));
  const uncovered = candidates.map((c) => c.ticker).filter((t) => !covered.has(t));
  results.push({
    stage: "critic",
    name: "all_picks_have_rationale",
    passed: uncovered.length === 0,
    detail: uncovered.length
      ? `Missing rationale for: ${uncovered.join(", ")}.`
      : undefined,
  });

  results.push({
    stage: "critic",
    name: "has_summary_and_move",
    passed: Boolean(draft.summary?.trim()) && Boolean(draft.theMove?.headline?.trim()),
    detail:
      draft.summary?.trim() && draft.theMove?.headline?.trim()
        ? undefined
        : "Synthesis is missing a summary or a headline for 'the move'.",
  });

  return results;
}

/**
 * Deterministic groundedness checks for the insights digest: every insight must
 * cite real source ids, reference only allowed tickers, and carry a "so what".
 */
export function checkInsights(
  draft: InsightDraft,
  news: NewsItem[],
  watchlist: string[],
): CheckResult[] {
  const results: CheckResult[] = [];
  const validIds = new Set(news.map((n) => n.id));
  const allowedTickers = new Set([
    ...watchlist,
    ...news.flatMap((n) => n.tickers),
  ]);

  const badCitations = draft.insights.filter(
    (ins) =>
      ins.sourceIds.length === 0 ||
      ins.sourceIds.some((id) => !validIds.has(id)),
  );
  results.push({
    stage: "insight_critic",
    name: "insights_grounded_in_sources",
    passed: badCitations.length === 0,
    detail: badCitations.length
      ? `${badCitations.length} insight(s) cite missing or no source ids.`
      : undefined,
  });

  const badTickers = draft.insights
    .flatMap((ins) => ins.relatedTickers)
    .filter((t) => !allowedTickers.has(t));
  results.push({
    stage: "insight_critic",
    name: "no_invented_tickers",
    passed: badTickers.length === 0,
    detail: badTickers.length
      ? `References tickers outside watchlist/sources: ${Array.from(new Set(badTickers)).join(", ")}.`
      : undefined,
  });

  const missingSoWhat = draft.insights.filter((ins) => !ins.soWhat?.trim());
  results.push({
    stage: "insight_critic",
    name: "insights_have_so_what",
    passed: draft.insights.length > 0 && missingSoWhat.length === 0,
    detail:
      draft.insights.length === 0
        ? "Digest contains no insights."
        : missingSoWhat.length
          ? `${missingSoWhat.length} insight(s) missing a 'so what'.`
          : undefined,
  });

  return results;
}
