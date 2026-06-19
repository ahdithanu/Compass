// Newsletter / RSS source registry. Curated defaults plus an env override so
// the feed list is configurable without code changes. Later this can become
// per-user (a `sources` table keyed by profile); the ingestion layer doesn't
// care where the list comes from.

export interface FeedSource {
  name: string;
  url: string;
  category?: string;
}

// Reputable, broadly-available finance/markets feeds. The ingestion layer
// tolerates any of these being unreachable, so the list is best-effort.
export const DEFAULT_FEEDS: FeedSource[] = [
  { name: "MarketWatch — Top Stories", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", category: "markets" },
  { name: "Investing.com — News", url: "https://www.investing.com/rss/news_25.rss", category: "markets" },
  { name: "Seeking Alpha — Market Currents", url: "https://seekingalpha.com/market_currents.xml", category: "markets" },
  { name: "Federal Reserve — Press Releases", url: "https://www.federalreserve.gov/feeds/press_all.xml", category: "macro" },
  { name: "NASDAQ — Original Content", url: "https://www.nasdaq.com/feed/rssoutbound", category: "markets" },
];

/**
 * Resolve the active feed list. `NEWSLETTER_FEEDS` overrides the defaults:
 * a comma-separated list of either bare URLs or `Name|url` pairs.
 */
export function configuredFeeds(): FeedSource[] {
  const raw = process.env.NEWSLETTER_FEEDS?.trim();
  if (!raw) return DEFAULT_FEEDS;

  const parsed = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): FeedSource | null => {
      const [a, b] = entry.split("|").map((s) => s.trim());
      const url = b ?? a;
      const name = b ? a : safeHostname(url);
      return url ? { name, url } : null;
    })
    .filter((f): f is FeedSource => f !== null);

  return parsed.length > 0 ? parsed : DEFAULT_FEEDS;
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "newsletter";
  }
}
