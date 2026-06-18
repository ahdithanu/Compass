// Market-news client (Financial Modeling Prep). Same resilience contract as the
// quotes client: timeout + one retry, then a deterministic sample feed so the
// insights engine stays functional with no API key. Returns items with stable
// ids so the synthesizer can cite specific sources.

import type { NewsItem } from "./types";
import { fetchWithTimeout, withRetry } from "./resilience";

const FMP_V3 = "https://financialmodelingprep.com/api/v3";
const FMP_V4 = "https://financialmodelingprep.com/api/v4";
const NEWS_TIMEOUT_MS = 4000;

export interface NewsResult {
  items: NewsItem[];
  source: "live" | "fallback";
}

const SAMPLE_NEWS: NewsItem[] = [
  {
    id: "s1",
    title: "Megacap tech leads broad market pullback as rates tick higher",
    source: "Sample Wire",
    publishedAt: "2026-06-17T13:30:00Z",
    tickers: ["QQQM", "XLK", "VTI"],
    summary:
      "Large-cap technology names led indices lower as Treasury yields rose, pressuring high-multiple growth stocks while defensive sectors held up.",
  },
  {
    id: "s2",
    title: "Semiconductor demand outlook stays firm on AI capex",
    source: "Sample Wire",
    publishedAt: "2026-06-17T11:05:00Z",
    tickers: ["SMH", "XLK"],
    summary:
      "Continued data-center and AI infrastructure spending is keeping semiconductor demand resilient even as broader tech wobbles.",
  },
  {
    id: "s3",
    title: "Dividend and staples names outperform in risk-off session",
    source: "Sample Wire",
    publishedAt: "2026-06-17T10:10:00Z",
    tickers: ["SCHD", "XLV"],
    summary:
      "Quality dividend payers and defensive sectors outperformed as investors rotated away from higher-beta growth.",
  },
  {
    id: "s4",
    title: "Bonds catch a modest bid as growth data softens",
    source: "Sample Wire",
    publishedAt: "2026-06-16T20:45:00Z",
    tickers: ["BND"],
    summary:
      "Softer economic data nudged investors toward high-quality bonds, lifting aggregate bond funds modestly.",
  },
  {
    id: "s5",
    title: "Clean-energy names rebound on policy clarity",
    source: "Sample Wire",
    publishedAt: "2026-06-16T15:20:00Z",
    tickers: ["ICLN"],
    summary:
      "Renewable-energy equities bounced after clearer policy signals reduced regulatory uncertainty for the sector.",
  },
];

function fallback(tickers: string[]): NewsResult {
  if (tickers.length === 0) return { items: SAMPLE_NEWS, source: "fallback" };
  const set = new Set(tickers);
  const relevant = SAMPLE_NEWS.filter((n) => n.tickers.some((t) => set.has(t)));
  // Always include a couple of market-wide items for context.
  const general = SAMPLE_NEWS.filter((n) => !relevant.includes(n)).slice(0, 2);
  return { items: [...relevant, ...general].slice(0, 8), source: "fallback" };
}

interface FmpNews {
  symbol?: string;
  publishedDate: string;
  title: string;
  site: string;
  text: string;
  url: string;
}

function normalize(raw: FmpNews[], idPrefix: string): NewsItem[] {
  return raw
    .filter((n) => n.title)
    .map((n, i) => ({
      id: `${idPrefix}${i}`,
      title: n.title,
      source: n.site ?? "FMP",
      publishedAt: n.publishedDate ?? "",
      tickers: n.symbol ? [n.symbol] : [],
      summary: (n.text ?? "").slice(0, 400),
      url: n.url,
    }));
}

export async function getMarketNews(
  tickers: string[],
  limit = 12,
): Promise<NewsResult> {
  const key = process.env.FMP_API_KEY;
  if (!key) return fallback(tickers);

  const result = await withRetry(
    async () => {
      const stockUrl = tickers.length
        ? `${FMP_V3}/stock_news?tickers=${tickers.join(",")}&limit=${limit}&apikey=${key}`
        : `${FMP_V4}/general_news?page=0&apikey=${key}`;
      const res = await fetchWithTimeout(stockUrl, NEWS_TIMEOUT_MS);
      if (!res.ok) throw new Error(`FMP news HTTP ${res.status}`);
      const json = (await res.json()) as FmpNews[];
      if (!Array.isArray(json) || json.length === 0) {
        throw new Error("FMP news empty");
      }
      return normalize(json.slice(0, limit), "n");
    },
    { retries: 1, label: "news.getMarketNews" },
  );

  if (!result || result.length === 0) return fallback(tickers);
  return { items: result, source: "live" };
}
