// Deterministic allocation + candidate-selection engine. This is the
// rule-based backbone: it decides the asset mix, the sectors to watch, and the
// concrete tickers. The LLM only ever writes the "why" around these outputs —
// it never invents tickers — which is what makes the critic gate enforceable.

import type {
  Allocation,
  CandidatePick,
  Profile,
  SectorWatch,
} from "./types";

/**
 * Age- and risk-based glide path. Base equity from a "120 minus age" rule,
 * shifted by risk tolerance and shortened horizons, then split into
 * bonds/cash/alternatives.
 */
export function buildAllocation(profile: Profile): Allocation {
  const { age, riskTolerance, horizonYears, goal } = profile;

  let stocks = Math.max(20, Math.min(95, 120 - age));

  if (riskTolerance === "aggressive") stocks += 12;
  if (riskTolerance === "conservative") stocks -= 15;

  if (goal === "income") stocks -= 10;
  if (goal === "preservation") stocks -= 20;
  if (goal === "short_term") stocks -= 30;
  if (goal === "growth") stocks += 8;

  // Short horizons cap equity exposure regardless of the above.
  if (horizonYears <= 3) stocks = Math.min(stocks, 40);
  else if (horizonYears <= 7) stocks = Math.min(stocks, 65);

  stocks = clamp(stocks, 10, 95);

  // Alternatives only for moderate/aggressive with a real horizon, and never
  // more than the room left after equities (otherwise bonds/cash go negative).
  let alternatives = 0;
  if (riskTolerance !== "conservative" && horizonYears >= 5) {
    alternatives = riskTolerance === "aggressive" ? 8 : 5;
  }
  alternatives = clamp(alternatives, 0, 100 - stocks);

  const remaining = 100 - stocks - alternatives;
  // Cash floor scales up as horizon shortens / preservation matters.
  let cash =
    goal === "short_term" || goal === "preservation"
      ? Math.min(remaining, 20)
      : Math.min(remaining, 5);
  cash = clamp(cash, 0, remaining);

  const bonds = remaining - cash;

  return round100({ stocks, bonds, cash, alternatives });
}

/** Static interest/theme -> thematic ETF map (kept intentionally small + real). */
const THEME_MAP: Record<string, CandidatePick> = {
  ai: { ticker: "BOTZ", name: "Global X Robotics & AI ETF", kind: "etf", bucket: "thematic" },
  "artificial intelligence": { ticker: "BOTZ", name: "Global X Robotics & AI ETF", kind: "etf", bucket: "thematic" },
  semiconductors: { ticker: "SMH", name: "VanEck Semiconductor ETF", kind: "etf", bucket: "thematic" },
  chips: { ticker: "SMH", name: "VanEck Semiconductor ETF", kind: "etf", bucket: "thematic" },
  "clean energy": { ticker: "ICLN", name: "iShares Global Clean Energy ETF", kind: "etf", bucket: "thematic" },
  "renewable energy": { ticker: "ICLN", name: "iShares Global Clean Energy ETF", kind: "etf", bucket: "thematic" },
  healthcare: { ticker: "XLV", name: "Health Care Select Sector SPDR", kind: "etf", bucket: "thematic" },
  biotech: { ticker: "XBI", name: "SPDR S&P Biotech ETF", kind: "etf", bucket: "thematic" },
  technology: { ticker: "XLK", name: "Technology Select Sector SPDR", kind: "etf", bucket: "thematic" },
  tech: { ticker: "XLK", name: "Technology Select Sector SPDR", kind: "etf", bucket: "thematic" },
  cybersecurity: { ticker: "CIBR", name: "First Trust Cybersecurity ETF", kind: "etf", bucket: "thematic" },
  crypto: { ticker: "BITO", name: "ProShares Bitcoin Strategy ETF", kind: "etf", bucket: "thematic" },
  bitcoin: { ticker: "BITO", name: "ProShares Bitcoin Strategy ETF", kind: "etf", bucket: "thematic" },
  dividends: { ticker: "SCHD", name: "Schwab US Dividend Equity ETF", kind: "etf", bucket: "income" },
  realestate: { ticker: "VNQ", name: "Vanguard Real Estate ETF", kind: "etf", bucket: "thematic" },
  "real estate": { ticker: "VNQ", name: "Vanguard Real Estate ETF", kind: "etf", bucket: "thematic" },
};

/**
 * Pick concrete tickers from the allocation. Core/defensive/income buckets are
 * filled with broad, low-cost ETFs; thematic slots come from the user's stated
 * interests. Everything returned here is a fixed, real instrument.
 */
export function selectCandidates(
  profile: Profile,
  alloc: Allocation,
): CandidatePick[] {
  const picks: CandidatePick[] = [];

  if (alloc.stocks > 0) {
    picks.push({ ticker: "VTI", name: "Vanguard Total US Stock Market ETF", kind: "etf", bucket: "core" });
    if (alloc.stocks >= 40) {
      picks.push({ ticker: "VXUS", name: "Vanguard Total International Stock ETF", kind: "etf", bucket: "core" });
    }
    if (profile.goal === "growth" || profile.riskTolerance === "aggressive") {
      picks.push({ ticker: "QQQM", name: "Invesco NASDAQ-100 ETF", kind: "etf", bucket: "growth" });
    }
  }

  if (alloc.bonds > 0) {
    picks.push({ ticker: "BND", name: "Vanguard Total Bond Market ETF", kind: "etf", bucket: "defensive" });
  }

  if (profile.goal === "income" || profile.goal === "preservation") {
    picks.push({ ticker: "SCHD", name: "Schwab US Dividend Equity ETF", kind: "etf", bucket: "income" });
  }

  if (alloc.alternatives > 0) {
    picks.push({ ticker: "GLD", name: "SPDR Gold Shares", kind: "etf", bucket: "defensive" });
  }

  // Thematic slots from interests (deduped, max 3).
  const seen = new Set(picks.map((p) => p.ticker));
  for (const interest of profile.interests) {
    const theme = THEME_MAP[interest.trim().toLowerCase()];
    if (theme && !seen.has(theme.ticker)) {
      picks.push(theme);
      seen.add(theme.ticker);
    }
    if (picks.filter((p) => p.bucket === "thematic").length >= 3) break;
  }

  return picks;
}

/** Sectors to watch, biased by goal + interests. Momentum is filled in later. */
export function baseSectors(profile: Profile): SectorWatch[] {
  const sectors: SectorWatch[] = [];
  const add = (sector: string, why: string) => sectors.push({ sector, why });

  if (profile.goal === "growth" || profile.riskTolerance === "aggressive") {
    add("Technology", "Primary engine of long-run equity growth and your higher risk budget.");
    add("Communication Services", "Houses the mega-cap platforms driving index returns.");
  }
  if (profile.goal === "income" || profile.goal === "preservation") {
    add("Consumer Staples", "Defensive cash flows that hold up when markets wobble.");
    add("Utilities", "Steady, regulated income — a ballast for income-focused portfolios.");
  }
  if (profile.goal === "retirement") {
    add("Healthcare", "Defensive growth with secular demographic tailwinds for the long horizon.");
  }
  // Always surface one broad-market context sector.
  add("Financials", "A read on rates and the broader economic cycle.");

  return sectors.slice(0, 4);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** Round to whole percents while guaranteeing the sum is exactly 100. */
function round100(a: Allocation): Allocation {
  const rounded = {
    stocks: Math.round(a.stocks),
    bonds: Math.round(a.bonds),
    cash: Math.round(a.cash),
    alternatives: Math.round(a.alternatives),
  };
  const diff = 100 - (rounded.stocks + rounded.bonds + rounded.cash + rounded.alternatives);
  // Push any rounding residue onto the largest bucket.
  const largest = (Object.keys(rounded) as (keyof Allocation)[]).reduce((m, k) =>
    rounded[k] > rounded[m] ? k : m,
  );
  rounded[largest] += diff;
  return rounded;
}
