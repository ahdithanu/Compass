// Cross-references a pick's ticker against the insights digest so each pick can
// show *why* it's there — which of the things you read actually mention it.
// Pure + presentation-free so it's easy to test and reuse.

import type { InsightDigest } from "./types";

export interface PickEvidence {
  /** Insights whose related tickers include this pick. */
  insights: { title: string; soWhat: string }[];
  /** Distinct source items that tag this ticker, for citation/links. */
  sources: { id: string; source: string; title: string; url?: string }[];
}

const EMPTY: PickEvidence = { insights: [], sources: [] };

/**
 * Find the insights and source items in `digest` that reference `ticker`.
 * Matching is case-insensitive and exact (no substring) so "BND" doesn't match
 * "BNDX". Returns empty evidence when there's no digest or no match.
 */
export function evidenceForTicker(
  ticker: string,
  digest: InsightDigest | null | undefined,
): PickEvidence {
  if (!digest) return EMPTY;
  const want = ticker.trim().toUpperCase();
  if (!want) return EMPTY;

  const has = (tickers: string[] | undefined) =>
    (tickers ?? []).some((t) => t.trim().toUpperCase() === want);

  const insights = digest.insights
    .filter((ins) => has(ins.relatedTickers))
    .map((ins) => ({ title: ins.title, soWhat: ins.soWhat }));

  const seen = new Set<string>();
  const sources: PickEvidence["sources"] = [];
  for (const s of digest.sources) {
    if (!has(s.tickers) || seen.has(s.id)) continue;
    seen.add(s.id);
    sources.push({ id: s.id, source: s.source, title: s.title, url: s.url });
  }

  if (insights.length === 0 && sources.length === 0) return EMPTY;
  return { insights, sources };
}
