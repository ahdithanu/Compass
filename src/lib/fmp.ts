// Market-data client (Financial Modeling Prep). Degrades gracefully: if no API
// key is set or the feed errors, it returns deterministic sample quotes so the
// rest of the pipeline — and the UI — keep working. The caller is told which
// source was used so the audit trail and disclaimers stay honest.

import type { Quote } from "./types";
import { fetchWithTimeout, withRetry } from "./resilience";

// FMP's current "stable" API. The legacy /api/v3 endpoints were retired for keys
// created after 2025-08-31, so we use /stable/quote (one symbol per call).
const FMP_BASE = "https://financialmodelingprep.com/stable";
const FMP_TIMEOUT_MS = 4000;

export interface MarketData {
  quotes: Quote[];
  source: "live" | "fallback";
}

/** Static fallback so the app is fully functional without any API keys. */
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

// One /stable/quote call for a single symbol. Returns null on any failure
// (HTTP error, FMP "Error Message" object, empty array, or unusable price).
interface FmpStableQuote {
  symbol?: string;
  name?: string;
  price?: number;
  changePercentage?: number; // stable API field
  changesPercentage?: number; // legacy field name, just in case
}

async function fetchOne(symbol: string, key: string): Promise<Quote | null> {
  const row = await withRetry(
    async () => {
      const url = `${FMP_BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${key}`;
      const res = await fetchWithTimeout(url, FMP_TIMEOUT_MS, {
        next: { revalidate: 60 },
      });
      if (!res.ok) throw new Error(`FMP HTTP ${res.status}`);
      const json = (await res.json()) as unknown;
      // Free-tier / gated endpoints answer 200 with { "Error Message": ... }.
      if (!Array.isArray(json) || json.length === 0) {
        throw new Error("FMP empty or error response");
      }
      return json[0] as FmpStableQuote;
    },
    { retries: 1, label: `fmp.quote:${symbol}` },
  );

  if (!row || !Number.isFinite(Number(row.price))) return null;
  const cp = row.changePercentage ?? row.changesPercentage;
  return {
    symbol: row.symbol ?? symbol,
    name: row.name ?? symbol,
    price: Number(row.price),
    changePercent: Number.isFinite(Number(cp)) ? Number(cp) : 0,
  };
}

export async function getQuotes(symbols: string[]): Promise<MarketData> {
  const unique = Array.from(new Set(symbols));
  const key = process.env.FMP_API_KEY;
  if (!key || unique.length === 0) return fallback(unique);

  // Fetch each symbol concurrently; tolerate partial failure.
  const results = await Promise.all(unique.map((s) => fetchOne(s, key)));
  const live = results.filter((q): q is Quote => q !== null);
  if (live.length === 0) return fallback(unique);
  return { quotes: live, source: "live" };
}
