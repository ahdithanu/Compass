// Core domain types for the personalized investing co-pilot.

export type Goal =
  | "retirement"
  | "growth"
  | "income"
  | "preservation"
  | "short_term";

export type RiskTolerance = "conservative" | "moderate" | "aggressive";

export type JourneyStage =
  | "just_starting"
  | "building"
  | "established"
  | "nearing_goal";

/** What the user tells us about themselves. Editable at any time. */
export interface Profile {
  age: number;
  goal: Goal;
  riskTolerance: RiskTolerance;
  horizonYears: number;
  journeyStage: JourneyStage;
  monthlyContribution?: number;
  /** Free-form sectors/themes the user is drawn to, e.g. "AI", "clean energy". */
  interests: string[];
}

export interface Allocation {
  /** Percentages that must sum to 100. */
  stocks: number;
  bonds: number;
  cash: number;
  alternatives: number;
}

export type PickBucket =
  | "core"
  | "growth"
  | "income"
  | "defensive"
  | "thematic";

export interface CandidatePick {
  ticker: string;
  name: string;
  kind: "etf" | "stock";
  bucket: PickBucket;
}

export interface Pick extends CandidatePick {
  price?: number;
  changePercent?: number;
  /** The "why" for this specific pick. */
  rationale: string;
}

export interface SectorWatch {
  sector: string;
  why: string;
  /** Recent % change, when available from the market feed. */
  momentum?: number;
}

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
}

/** Result of a single checker gate in the pipeline. */
export interface CheckResult {
  stage: string;
  name: string;
  passed: boolean;
  detail?: string;
}

export interface Recommendation {
  allocation: Allocation;
  sectorsToWatch: SectorWatch[];
  picks: Pick[];
  theMove: { headline: string; reasoning: string };
  summary: string;
  disclaimers: string[];
  meta: {
    /** Correlation id for this run — present in every structured log line. */
    traceId: string;
    generatedAt: string;
    dataSource: "live" | "fallback";
    reasoningSource: "claude" | "rule_based";
    /** Full audit trail of every checker gate that ran. */
    checks: CheckResult[];
  };
}

/** The draft shape the LLM synthesizer is constrained to produce. */
export interface SynthesisDraft {
  summary: string;
  theMove: { headline: string; reasoning: string };
  sectorsToWatch: SectorWatch[];
  /** Rationale per ticker — tickers must come from the supplied candidate set. */
  pickRationales: { ticker: string; rationale: string }[];
}

export interface CritiqueResult {
  passed: boolean;
  issues: string[];
}
