// POST /api/backtest
// Backtests a $-amount portfolio (built from a stocks/bonds/cash/alts mix)
// against monthly history, plus a 100%-equity benchmark. Uses live Alpha
// Vantage history when configured, else a deterministic simulated market.

import { NextResponse } from "next/server";
import { backtest, type Position } from "@/lib/backtest";
import { getMonthlySeries } from "@/lib/history-prices";
import { checkRateLimit, clientKey, envLimit } from "@/lib/ratelimit";
import { readJsonCapped, BodyTooLargeError, bodyTooLargeResponse, rateLimitedResponse } from "@/lib/http";
import { withRequest } from "@/lib/api";

const WINDOW_MS = 60_000;
const limitFor = () => envLimit("API_RATE_LIMIT_BACKTEST", 20);

// Each allocation bucket maps to a representative, liquid instrument.
const BUCKET_TICKER: Record<string, string> = {
  stocks: "VTI",
  bonds: "BND",
  cash: "CASH",
  alternatives: "GLD",
};
const BENCHMARK = "VTI";
const MAX_YEARS = 10;

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const POST = withRequest("backtest", async (request) => {
  const rl = await checkRateLimit(clientKey(request, "backtest"), limitFor(), WINDOW_MS);
  if (!rl.ok) return rateLimitedResponse(rl);

  let body: unknown;
  try {
    body = await readJsonCapped(request);
  } catch (err) {
    if (err instanceof BodyTooLargeError) return bodyTooLargeResponse();
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const b = (body ?? {}) as {
    weights?: Record<string, unknown>;
    amount?: unknown;
    years?: unknown;
  };
  const w = b.weights ?? {};
  const weights = {
    stocks: num(w.stocks),
    bonds: num(w.bonds),
    cash: num(w.cash),
    alternatives: num(w.alternatives),
  };
  const total = weights.stocks + weights.bonds + weights.cash + weights.alternatives;
  if (total <= 0) {
    return NextResponse.json({ error: "Provide a non-zero allocation." }, { status: 400 });
  }

  const amount = Math.min(10_000_000, Math.max(1, num(b.amount, 1000)));
  const years = Math.min(MAX_YEARS, Math.max(1, Math.round(num(b.years, 3))));
  const months = years * 12;

  const positions: Position[] = (
    Object.keys(BUCKET_TICKER) as (keyof typeof weights)[]
  )
    .filter((k) => weights[k] > 0)
    .map((k) => ({ ticker: BUCKET_TICKER[k], weight: weights[k] }));

  const symbols = [...new Set([...positions.map((p) => p.ticker), BENCHMARK])];
  const { series, source } = await getMonthlySeries(symbols, months);
  const byTicker = Object.fromEntries(series.map((s) => [s.ticker, s]));

  const portfolio = backtest(positions, byTicker, amount);
  const benchmark = backtest([{ ticker: BENCHMARK, weight: 1 }], byTicker, amount);

  return NextResponse.json({
    portfolio,
    benchmark,
    source,
    positions: positions.map((p) => ({
      ticker: p.ticker,
      weight: Math.round((p.weight / total) * 100),
      amount: Math.round((p.weight / total) * amount),
    })),
    years,
  });
});
