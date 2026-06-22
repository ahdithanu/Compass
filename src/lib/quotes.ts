// Market-data client. Degrades gracefully: if no API key is set or the feed
// errors, it returns deterministic sample quotes so the rest of the pipeline —
// and the UI — keep working. The caller is told which source was used so the
// audit trail and disclaimers stay honest.
//
// Provider-flexible: uses Alpha Vantage if ALPHAVANTAGE_API_KEY is set, else
// Finnhub if FINNHUB_API_KEY is set, else the static sample set. Both free tiers
// cover US stocks/ETFs (Alpha Vantage caps at ~25 req/day; Finnhub ~60/min).
// One symbol per call either way; we only quote the handful of candidates.

import type { Quote } from "./types";
import { fetchWithTimeout, withRetry } from "./resilience";

const QUOTE_TIMEOUT_MS = 4000;

export interface MarketData {
  quotes: Quote[];
  source: "live" | "fallback";
}

/** Static fallback so the app is fully functional without any API keys. Also
 *  the source of human-readable names (the quote endpoints return price only). */
const SAMPLE_QUOTES: Record<string, Quote> = {
  VTI: { symbol: "VTI", name: "Vanguard Total US Stock Market ETF", price: 295.4, changePercent: -0.8 },
  VXUS: { symbol: "VXUS", name: "Vanguard Total International Stock ETF", price: 68.2, changePercent: -0.4 },
  QQQM: { symbol: "QQQM", name: "Invesco NASDAQ-100 ETF", price: 215.1, changePercent: -1.3 },
  BND: { symbol: "BND", name: "Vanguard Total Bond Market ETF", price: 73.6, changePercent: 0.2 },
  SCHD: { symbol: "SCHD", name: "Schwab US Dividend Equity ETF", price: 27.9, changePercent: -0.3 },
  GLD: { symbol: "GLD", name: "SPDR Gold Shares", price: 248.7, changePercent: 0.6 },
  BOTZ: { symbol: "BOTZ", name: "Global X Robotics & AI ETF", price: 33.4, changePercent: -1.5 },
  SMH: { symbol: "SMH", name: "VanEck Semiconductor ETF", price: 268.9, changePercent: -2.1 },
  ICLN: { symbol: "ICLN", name: "iShares Global Clean Energy ETF", price: 13.2, changePercent: 0.9 },
  XLV: { symbol: "XLV", name: "Health Care Select Sector SPDR", price: 148.5, changePercent: 0.4 },
  XBI: { symbol: "XBI", name: "SPDR S&P Biotech ETF", price: 92.3, changePercent: -0.7 },
  XLK: { symbol: "XLK", name: "Technology Select Sector SPDR", price: 235.8, changePercent: -1.4 },
  CIBR: { symbol: "CIBR", name: "First Trust Cybersecurity ETF", price: 68.1, changePercent: -0.9 },
  BITO: { symbol: "BITO", name: "ProShares Bitcoin Strategy ETF", price: 22.4, changePercent: -3.2 },
  VNQ: { symbol: "VNQ", name: "Vanguard Real Estate ETF", price: 91.7, changePercent: 0.5 },
};

function fallback(symbols: string[]): MarketData {
  const quotes = symbols
    .map((s) => SAMPLE_QUOTES[s])
    .filter((q): q is Quote => Boolean(q));
  return { quotes, source: "fallback" };
}

function toQuote(symbol: string, price: number, changePercent: number): Quote {
  return {
    symbol,
    name: SAMPLE_QUOTES[symbol]?.name ?? symbol,
    price,
    changePercent: Number.isFinite(changePercent) ? changePercent : 0,
  };
}

// --- Alpha Vantage (GLOBAL_QUOTE) ---
async function fetchAlphaVantage(symbol: string, key: string): Promise<Quote | null> {
  const data = await withRetry(
    async () => {
      const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${key}`;
      const res = await fetchWithTimeout(url, QUOTE_TIMEOUT_MS, { next: { revalidate: 60 } });
      if (!res.ok) throw new Error(`AlphaVantage HTTP ${res.status}`);
      const json = (await res.json()) as { "Global Quote"?: Record<string, string> };
      const q = json["Global Quote"];
      // Rate-limit / error responses come back as {Note|Information: ...} with no quote.
      if (!q || !q["05. price"]) throw new Error("AlphaVantage no data / rate limited");
      return q;
    },
    { retries: 1, label: `av.quote:${symbol}` },
  );
  if (!data) return null;
  const price = parseFloat(data["05. price"]);
  const changePercent = parseFloat(String(data["10. change percent"] ?? "").replace("%", ""));
  if (!Number.isFinite(price)) return null;
  return toQuote(symbol, price, changePercent);
}

// --- Finnhub (/quote) ---
async function fetchFinnhub(symbol: string, key: string): Promise<Quote | null> {
  const data = await withRetry(
    async () => {
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`;
      const res = await fetchWithTimeout(url, QUOTE_TIMEOUT_MS, { next: { revalidate: 60 } });
      if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
      const json = (await res.json()) as { c?: number; dp?: number };
      // Unknown symbol / no data comes back as { c: 0, dp: null, ... }.
      if (!json || !Number.isFinite(json.c) || json.c === 0) throw new Error("Finnhub no data");
      return json;
    },
    { retries: 1, label: `finnhub.quote:${symbol}` },
  );
  if (!data) return null;
  if (!Number.isFinite(Number(data.c))) return null;
  return toQuote(symbol, Number(data.c), Number(data.dp));
}

export async function getQuotes(symbols: string[]): Promise<MarketData> {
  const unique = Array.from(new Set(symbols));
  if (unique.length === 0) return fallback(unique);

  const avKey = process.env.ALPHAVANTAGE_API_KEY;
  const fhKey = process.env.FINNHUB_API_KEY;
  const fetchOne = avKey
    ? (s: string) => fetchAlphaVantage(s, avKey)
    : fhKey
      ? (s: string) => fetchFinnhub(s, fhKey)
      : null;
  if (!fetchOne) return fallback(unique);

  // Fetch each symbol concurrently; tolerate partial failure.
  const results = await Promise.all(unique.map((s) => fetchOne(s)));
  const live = results.filter((q): q is Quote => q !== null);
  return live.length > 0 ? { quotes: live, source: "live" } : fallback(unique);
}
