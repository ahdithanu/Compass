// Monthly historical price series for the backtester.
//   • Live: Alpha Vantage TIME_SERIES_MONTHLY_ADJUSTED when ALPHAVANTAGE_API_KEY
//     is set (adjusted closes, so splits/dividends are handled).
//   • Simulated: a deterministic seeded random-walk per ticker otherwise, with
//     drift/volatility calibrated by asset class. Reproducible (seeded by the
//     symbol) and clearly labeled so it's never mistaken for real history.

import type { PriceSeries } from "./backtest";
import { fetchWithTimeout } from "./resilience";

export type HistorySource = "live" | "simulated";

export interface HistoryResult {
  series: PriceSeries[];
  source: HistorySource;
}

// Rough annual drift / volatility by instrument, for the simulated market.
const PROFILE: Record<string, { drift: number; vol: number }> = {
  VTI: { drift: 0.09, vol: 0.16 },
  VXUS: { drift: 0.07, vol: 0.17 },
  QQQM: { drift: 0.12, vol: 0.22 },
  SCHD: { drift: 0.08, vol: 0.13 },
  BND: { drift: 0.03, vol: 0.05 },
  GLD: { drift: 0.05, vol: 0.15 },
  CASH: { drift: 0.04, vol: 0.003 },
};
const DEFAULT_PROFILE = { drift: 0.08, vol: 0.2 };

// Pseudo-tickers with no market listing (e.g. a cash sleeve). These are always
// modeled synthetically — never fetched — so their absence from a price API
// can't sink an otherwise-live run. When live data is used, their series is
// generated on the *live* dates so the backtest's date intersection lines up.
const SYNTHETIC = new Set(["CASH"]);

export async function getMonthlySeries(
  symbols: string[],
  months: number,
  now: number = Date.now(),
): Promise<HistoryResult> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const real = uniq.filter((s) => !SYNTHETIC.has(s));
  const synthetic = uniq.filter((s) => SYNTHETIC.has(s));
  const key = process.env.ALPHAVANTAGE_API_KEY;

  if (key && real.length > 0) {
    try {
      const fetched = await Promise.all(
        real.map((s) => fetchAlphaVantageMonthly(s, months, key)),
      );
      const ok = fetched.filter((s): s is PriceSeries => s !== null);
      // Require every *real* symbol to resolve (mixing live + simulated real
      // prices would be misleading). Synthetic sleeves are then generated on the
      // live dates so they intersect the real series in the backtest.
      if (ok.length === real.length) {
        const templateDates = ok[0]?.points.map((p) => p.date) ?? [];
        const synth = synthetic.map((s) => simulateOnDates(s, templateDates));
        return { series: [...ok, ...synth], source: "live" };
      }
    } catch {
      // fall through to simulated
    }
  }

  // Fully simulated: every series uses the same month-start date generation, so
  // they align with each other for the intersection.
  return {
    series: uniq.map((s) => simulateSeries(s, months, now)),
    source: "simulated",
  };
}

async function fetchAlphaVantageMonthly(
  symbol: string,
  months: number,
  key: string,
): Promise<PriceSeries | null> {
  const url =
    `https://www.alphavantage.co/query?function=TIME_SERIES_MONTHLY_ADJUSTED` +
    `&symbol=${encodeURIComponent(symbol)}&apikey=${key}`;
  try {
    const res = await fetchWithTimeout(url, 8000);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      "Monthly Adjusted Time Series"?: Record<string, Record<string, string>>;
    };
    const raw = data["Monthly Adjusted Time Series"];
    if (!raw) return null; // rate-limited or bad symbol
    const points = Object.entries(raw)
      .map(([date, row]) => ({
        date,
        close: Number(row["5. adjusted close"]),
      }))
      .filter((p) => Number.isFinite(p.close) && p.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-months);
    return points.length ? { ticker: symbol, points } : null;
  } catch {
    return null;
  }
}

// --- Deterministic simulated market ----------------------------------------

function simulateSeries(ticker: string, months: number, now: number): PriceSeries {
  const { drift, vol } = PROFILE[ticker] ?? DEFAULT_PROFILE;
  const rng = mulberry32(hashSeed(ticker));
  const mDrift = drift / 12;
  const mVol = vol / Math.sqrt(12);

  const base = new Date(now);
  const points = [];
  let price = 100;
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const r = mDrift + mVol * gauss(rng);
    price = Math.max(1, price * (1 + r));
    points.push({ date: isoMonth(d), close: Math.round(price * 100) / 100 });
  }
  return { ticker, points };
}

/** A synthetic series on caller-supplied dates (used to align a cash sleeve to
 *  the live price dates). Same seeded walk, but the x-axis comes from outside. */
function simulateOnDates(ticker: string, dates: string[]): PriceSeries {
  const { drift, vol } = PROFILE[ticker] ?? DEFAULT_PROFILE;
  const rng = mulberry32(hashSeed(ticker));
  const mDrift = drift / 12;
  const mVol = vol / Math.sqrt(12);
  let price = 100;
  const points = dates.map((date) => {
    const r = mDrift + mVol * gauss(rng);
    price = Math.max(1, price * (1 + r));
    return { date, close: Math.round(price * 100) / 100 };
  });
  return { ticker, points };
}

function isoMonth(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
