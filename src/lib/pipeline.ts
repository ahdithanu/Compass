// The orchestrator. Runs the recommendation through specialized stages, with a
// checker gate after each one. Per the agreed design:
//   - LLM synthesis is audited by an independent critic (LLM + deterministic).
//   - On failure: ONE revision attempt, then fall back to a rule-based rationale.
//   - Every check (pass and fail) is recorded in meta.checks for full audit.

import { buildAllocation, baseSectors, selectCandidates } from "./allocate";
import { critique, synthesize, type SynthesisContext } from "./claude";
import { getQuotes } from "./quotes";
import { logEvent, newTraceId } from "./observability";
import type {
  CheckResult,
  Pick,
  Profile,
  Recommendation,
  SectorWatch,
  SynthesisDraft,
} from "./types";
import {
  checkAllocation,
  checkMarketData,
  checkSynthesis,
  validateProfile,
} from "./validate";

const DISCLAIMERS = [
  "This is educational information, not personalized financial advice.",
  "All investing carries risk, including possible loss of principal. Past performance does not guarantee future results.",
  "Consider consulting a licensed financial advisor before making investment decisions.",
];

export class PipelineError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

export async function runRecommendationPipeline(
  rawProfile: unknown,
): Promise<Recommendation> {
  const traceId = newTraceId();
  const checks: CheckResult[] = [];
  // Record a check AND emit a structured trace line in one place.
  const record = (c: CheckResult) => {
    checks.push(c);
    logEvent({
      traceId,
      stage: c.stage,
      event: c.name,
      ok: c.passed,
      detail: c.detail,
    });
  };

  logEvent({ traceId, stage: "pipeline", event: "started" });

  // --- Stage 1: profile validation gate ---
  const validated = validateProfile(rawProfile);
  record({
    stage: "profile",
    name: "profile_valid",
    passed: validated.ok,
    detail: validated.ok ? undefined : validated.issues.join(" "),
  });
  if (!validated.ok || !validated.profile) {
    throw new PipelineError("Profile failed validation.", validated.issues);
  }
  const profile = validated.profile;

  // --- Stage 2: allocation + gate ---
  const allocation = buildAllocation(profile);
  const allocCheck = checkAllocation(allocation);
  record(allocCheck);
  if (!allocCheck.passed) {
    throw new PipelineError("Allocation failed its checker.", [
      allocCheck.detail ?? "Invalid allocation.",
    ]);
  }

  // --- Stage 3: candidates + market data + gate ---
  const candidates = selectCandidates(profile, allocation);
  const sectors = baseSectors(profile);
  const { quotes, source } = await getQuotes(candidates.map((c) => c.ticker));
  record(
    checkMarketData(
      quotes.map((q) => q.symbol),
      candidates,
      source,
    ),
  );

  const ctx: SynthesisContext = {
    profile,
    allocation,
    candidates,
    quotes,
    sectors,
    dataSource: source,
  };

  // --- Stages 4 + 5: synthesis with critic gate, revise once, then fallback ---
  let draft: SynthesisDraft | null = null;
  let reasoningSource: "claude" | "rule_based" = "rule_based";

  for (let attempt = 0; attempt < 2; attempt++) {
    const priorIssues =
      attempt === 0 ? undefined : collectFailedDetails(checks, "critic");
    const candidate = await synthesize(ctx, priorIssues);

    if (!candidate) {
      // No API key (or transient failure) -> deterministic fallback.
      record({
        stage: "synthesis",
        name: "llm_available",
        passed: false,
        detail: "Reasoning layer unavailable; using rule-based rationale.",
      });
      break;
    }

    // Deterministic critic checks.
    const deterministic = checkSynthesis(candidate, candidates).map((c) => ({
      ...c,
      name: `${c.name}_attempt${attempt + 1}`,
    }));
    deterministic.forEach(record);

    // Independent LLM critic.
    const verdict = await critique(candidate, ctx);
    const llmPassed = verdict ? verdict.passed : true; // no critic -> don't block
    record({
      stage: "critic",
      name: `llm_critic_attempt${attempt + 1}`,
      passed: llmPassed,
      detail: verdict?.issues?.length ? verdict.issues.join(" ") : undefined,
    });

    const passedAll = deterministic.every((c) => c.passed) && llmPassed;
    if (passedAll) {
      draft = candidate;
      reasoningSource = "claude";
      break;
    }
    // else: loop once more with the issues fed back in; if this was the second
    // attempt, we exit and fall back below.
  }

  // --- Assemble final recommendation ---
  const quoteBySymbol = new Map(quotes.map((q) => [q.symbol, q]));
  const rationaleByTicker = new Map(
    (draft?.pickRationales ?? []).map((p) => [p.ticker, p.rationale]),
  );

  const picks: Pick[] = candidates.map((c) => {
    const q = quoteBySymbol.get(c.ticker);
    return {
      ...c,
      price: q?.price,
      changePercent: q?.changePercent,
      rationale:
        rationaleByTicker.get(c.ticker) ?? ruleBasedRationale(c, profile),
    };
  });

  const sectorsToWatch: SectorWatch[] = draft?.sectorsToWatch?.length
    ? draft.sectorsToWatch
    : sectors;

  logEvent({
    traceId,
    stage: "pipeline",
    event: "completed",
    ok: true,
    detail: `${checks.filter((c) => c.passed).length}/${checks.length} checks passed; reasoning=${reasoningSource}; data=${source}`,
  });

  return {
    allocation,
    sectorsToWatch,
    picks,
    theMove: draft?.theMove ?? ruleBasedMove(profile, allocation),
    summary: draft?.summary ?? ruleBasedSummary(profile, allocation),
    disclaimers: DISCLAIMERS,
    meta: {
      traceId,
      generatedAt: new Date().toISOString(),
      dataSource: source,
      reasoningSource,
      checks,
    },
  };
}

function collectFailedDetails(checks: CheckResult[], stage: string): string[] {
  return checks
    .filter((c) => c.stage === stage && !c.passed && c.detail)
    .map((c) => c.detail as string);
}

// --- Deterministic fallbacks (used when the LLM is unavailable or fails twice) ---

function ruleBasedRationale(
  c: { bucket: string; name: string },
  profile: Profile,
): string {
  switch (c.bucket) {
    case "core":
      return `Broad, low-cost market exposure — the foundation for a ${profile.horizonYears}-year horizon.`;
    case "growth":
      return `Tilts toward higher-growth equities, matching your ${profile.riskTolerance} risk tolerance.`;
    case "income":
      return `Dividend-paying holdings aligned with your ${profile.goal} goal.`;
    case "defensive":
      return `Ballast that helps cushion drawdowns and smooth the ride.`;
    case "thematic":
      return `A focused position reflecting your stated interest, sized as a satellite — not a core holding.`;
    default:
      return `Part of a diversified mix built for your profile.`;
  }
}

function ruleBasedMove(profile: Profile, allocation: { stocks: number }) {
  return {
    headline:
      profile.journeyStage === "just_starting"
        ? "Start with the core, automate contributions, and let time work."
        : "Stay the course — rebalance toward your target mix.",
    reasoning: `Your target is roughly ${allocation.stocks}% stocks. The single highest-impact move for a ${profile.journeyStage.replace("_", " ")} investor is consistent contributions into broad, low-cost funds rather than timing individual names.`,
  };
}

function ruleBasedSummary(
  profile: Profile,
  allocation: { stocks: number; bonds: number },
) {
  return `Based on your age (${profile.age}), ${profile.goal} goal, ${profile.riskTolerance} risk tolerance, and ${profile.horizonYears}-year horizon, this plan centers on a ~${allocation.stocks}% stock / ${allocation.bonds}% bond core, with satellite positions reflecting your interests.`;
}
