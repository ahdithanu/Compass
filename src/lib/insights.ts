// Insights pipeline. Mirrors the recommendation pipeline's structure: fetch
// sources -> synthesize -> independent critic gate -> revise once -> safe
// fallback. Same trace/observability + full check audit.

import { buildAllocation, selectCandidates } from "./allocate";
import {
  critiqueInsights,
  synthesizeInsights,
  type InsightContext,
} from "./claude";
import { getMarketNews } from "./news";
import { logEvent, newTraceId } from "./observability";
import { PipelineError } from "./pipeline";
import type { CheckResult, Insight, InsightDigest, InsightDraft } from "./types";
import { checkInsights, validateProfile } from "./validate";

const DISCLAIMERS = [
  "These insights are educational summaries of public sources, not personalized financial advice.",
  "Source items may be time-sensitive; verify before acting. All investing carries risk.",
];

export async function runInsightsPipeline(
  rawProfile: unknown,
): Promise<InsightDigest> {
  const traceId = newTraceId();
  const checks: CheckResult[] = [];
  const record = (c: CheckResult) => {
    checks.push(c);
    logEvent({ traceId, stage: c.stage, event: c.name, ok: c.passed, detail: c.detail });
  };

  logEvent({ traceId, stage: "insights", event: "started" });

  // Stage 1: profile gate (reuses the same validator).
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

  // Stage 2: derive the same watchlist the recommendation uses, then fetch news.
  const watchlist = selectCandidates(profile, buildAllocation(profile)).map(
    (c) => c.ticker,
  );
  const { items: news, source } = await getMarketNews(watchlist);
  record({
    stage: "sources",
    name: "sources_present",
    passed: news.length > 0,
    detail:
      source === "fallback"
        ? "Using sample news (no FMP_API_KEY or feed unavailable)."
        : `Fetched ${news.length} live source items.`,
  });
  if (news.length === 0) {
    throw new PipelineError("No source items available.", [
      "The market-news feed returned nothing.",
    ]);
  }

  const ctx: InsightContext = { profile, watchlist, news };

  // Stages 3 + 4: synthesis with critic gate, revise once, then fallback.
  let draft: InsightDraft | null = null;
  let reasoningSource: "claude" | "rule_based" = "rule_based";

  for (let attempt = 0; attempt < 2; attempt++) {
    const priorIssues =
      attempt === 0
        ? undefined
        : checks
            .filter((c) => c.stage === "insight_critic" && !c.passed && c.detail)
            .map((c) => c.detail as string);

    const candidate = await synthesizeInsights(ctx, priorIssues);
    if (!candidate) {
      record({
        stage: "synthesis",
        name: "llm_available",
        passed: false,
        detail: "Reasoning layer unavailable; using rule-based digest.",
      });
      break;
    }

    const deterministic = checkInsights(candidate, news, watchlist).map((c) => ({
      ...c,
      name: `${c.name}_attempt${attempt + 1}`,
    }));
    deterministic.forEach(record);

    const verdict = await critiqueInsights(candidate, ctx);
    const llmPassed = verdict ? verdict.passed : true;
    record({
      stage: "insight_critic",
      name: `llm_critic_attempt${attempt + 1}`,
      passed: llmPassed,
      detail: verdict?.issues?.length ? verdict.issues.join(" ") : undefined,
    });

    if (deterministic.every((c) => c.passed) && llmPassed) {
      draft = candidate;
      reasoningSource = "claude";
      break;
    }
  }

  const insights: Insight[] = draft?.insights ?? ruleBasedInsights(news, watchlist);
  const headline =
    draft?.headline ?? "What's moving your watchlist right now";

  logEvent({
    traceId,
    stage: "insights",
    event: "completed",
    ok: true,
    detail: `${checks.filter((c) => c.passed).length}/${checks.length} checks passed; reasoning=${reasoningSource}; data=${source}`,
  });

  return {
    headline,
    insights,
    sources: news,
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

/** Deterministic fallback: one insight per source item, lightly templated. */
function ruleBasedInsights(
  news: { id: string; title: string; summary: string; tickers: string[] }[],
  watchlist: string[],
): Insight[] {
  const set = new Set(watchlist);
  return news.slice(0, 5).map((n) => {
    const related = n.tickers.filter((t) => set.has(t));
    return {
      title: n.title,
      summary: n.summary,
      soWhat: related.length
        ? `Touches your holdings (${related.join(", ")}) — worth a glance, not a reason to react.`
        : "Useful market context for your broader watchlist.",
      relatedTickers: related.length ? related : n.tickers,
      sourceIds: [n.id],
    };
  });
}
