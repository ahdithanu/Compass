// Buy-and-hold backtest engine. Given target weights, a starting cash amount,
// and a historical price series per ticker, it "buys" the portfolio at the
// first common date and marks it to market over time — returning the value
// curve plus the numbers that matter: total return, annualized (CAGR), and
// max drawdown. Pure and data-source-agnostic so it's trivially testable and
// works identically on real history or a simulated series.

export interface Position {
  ticker: string;
  /** Relative weight; the engine normalizes so weights need not sum to 1/100. */
  weight: number;
}

export interface PricePoint {
  /** ISO date (YYYY-MM-DD). Series must be ascending. */
  date: string;
  close: number;
}

export interface PriceSeries {
  ticker: string;
  points: PricePoint[];
}

export interface BacktestPoint {
  date: string;
  value: number;
}

export interface BacktestResult {
  startValue: number;
  endValue: number;
  totalReturnPct: number;
  annualizedReturnPct: number;
  /** Worst peak-to-trough decline over the period, as a positive percent. */
  maxDrawdownPct: number;
  points: BacktestPoint[];
  /** Tickers that had no usable series and were dropped from the run. */
  skipped: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Run a buy-and-hold backtest. Shares are bought at each ticker's close on the
 * first date common to every held series, then the basket is valued at every
 * subsequent common date. Weights are normalized; tickers without a series (or
 * without a positive opening price) are dropped and reported in `skipped`.
 */
export function backtest(
  positions: Position[],
  seriesByTicker: Record<string, PriceSeries | undefined>,
  startValue: number,
): BacktestResult {
  const start = Math.max(0, startValue || 0);

  // Keep only positions we have a usable (non-empty) series for.
  const usable = positions.filter(
    (p) => p.weight > 0 && (seriesByTicker[p.ticker]?.points?.length ?? 0) > 0,
  );
  const skipped = positions
    .filter((p) => !usable.includes(p))
    .map((p) => p.ticker);

  const emptyResult: BacktestResult = {
    startValue: round2(start),
    endValue: round2(start),
    totalReturnPct: 0,
    annualizedReturnPct: 0,
    maxDrawdownPct: 0,
    points: [],
    skipped,
  };
  if (usable.length === 0 || start === 0) return emptyResult;

  // Per-ticker date -> close lookup.
  const lookup: Record<string, Map<string, number>> = {};
  for (const p of usable) {
    const m = new Map<string, number>();
    for (const pt of seriesByTicker[p.ticker]!.points) {
      if (Number.isFinite(pt.close) && pt.close > 0) m.set(pt.date, pt.close);
    }
    lookup[p.ticker] = m;
  }

  // Dates present in *every* held series, ascending.
  const [first, ...rest] = usable;
  let common = [...lookup[first.ticker].keys()];
  for (const p of rest) {
    const m = lookup[p.ticker];
    common = common.filter((d) => m.has(d));
  }
  common.sort();
  if (common.length < 2) return emptyResult;

  const openDate = common[0];
  const totalWeight = usable.reduce((s, p) => s + p.weight, 0);

  // Buy at the opening date: shares_i = (start * weightFrac_i) / open_i.
  const shares: Record<string, number> = {};
  for (const p of usable) {
    const frac = p.weight / totalWeight;
    shares[p.ticker] = (start * frac) / lookup[p.ticker].get(openDate)!;
  }

  const points: BacktestPoint[] = common.map((date) => {
    let value = 0;
    for (const p of usable) value += shares[p.ticker] * lookup[p.ticker].get(date)!;
    return { date, value: round2(value) };
  });

  const endValue = points[points.length - 1].value;
  const totalReturnPct = ((endValue - start) / start) * 100;

  // Annualized (CAGR) over the elapsed calendar span.
  const spanMs = Date.parse(common[common.length - 1]) - Date.parse(openDate);
  const years = spanMs / (365.25 * 24 * 3600 * 1000);
  const annualizedReturnPct =
    years > 0 ? (Math.pow(endValue / start, 1 / years) - 1) * 100 : totalReturnPct;

  // Max drawdown: worst decline from a running peak.
  let peak = points[0].value;
  let maxDd = 0;
  for (const pt of points) {
    if (pt.value > peak) peak = pt.value;
    if (peak > 0) maxDd = Math.max(maxDd, (peak - pt.value) / peak);
  }

  return {
    startValue: round2(start),
    endValue,
    totalReturnPct: round2(totalReturnPct),
    annualizedReturnPct: round2(annualizedReturnPct),
    maxDrawdownPct: round2(maxDd * 100),
    points,
    skipped,
  };
}
