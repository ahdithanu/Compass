// API client for the FastAPI backend.
// Server components use this directly via fetch. Client components call the
// same routes through the Next.js rewrite at /api/*, which proxies to the
// backend on :8000 (see next.config.js).

const SERVER_API = process.env.API_URL || "http://127.0.0.1:8000";

function url(path: string, server: boolean) {
  // Server-side fetch must hit the backend directly. Client-side fetch goes
  // through Next's rewrite proxy at the same origin.
  return server ? `${SERVER_API}${path}` : path;
}

export type Rating = "BUY" | "HOLD" | "AVOID";

export interface CompanyScoreRow {
  ticker: string;
  rating: Rating;
  signal_score: number;
  market_score: number;
  news_score: number;
  fundamental_score: number;
  alt_score: number;
  momentum?: number | null;
  volatility?: number | null;
  drawdown?: number | null;
  rel_strength?: number | null;
  revenue_growth_yoy?: number | null;
  operating_margin?: number | null;
  pe_ratio?: number | null;
  n_events?: number | null;
  n_signals?: number | null;
}

export interface PerformanceSummary {
  starting_capital: number;
  ending_capital: number;
  total_return_pct: number;
  benchmark_return_pct: number | null;
  num_trades: number;
  win_rate_pct: number;
  max_drawdown_pct: number;
  sharpe_like: number;
  start_date: string;
  end_date: string;
}

export interface RiskReview {
  ticker: string;
  approved: boolean;
  suggested_weight_pct: number;
  flags: string[];
  notes: string[];
}

export interface RiskReport {
  as_of: string;
  concentration_pct_top: number;
  portfolio_volatility: number;
  portfolio_drawdown: number;
  cash_pct: number;
  flags: string[];
  per_ticker: RiskReview[];
}

export interface DashboardPayload {
  as_of: string;
  performance: PerformanceSummary;
  portfolio_snapshot: {
    cash_pct: number;
    concentration_pct_top: number;
    portfolio_volatility: number;
    flags: string[];
  };
  top_picks: CompanyScoreRow[];
  equity_curve: { date: string; value: number }[];
}

export interface UniversePayload {
  universe: string[];
  benchmark: string;
  weights: { market: number; news: number; fundamentals: number; alternative: number };
  thresholds: { buy: number; hold: number };
  starting_capital: number;
}

export interface TickerDetail {
  ticker: string;
  scores: CompanyScoreRow;
  position_series: { date: string; shares: number }[];
  trades: {
    date: string;
    ticker: string;
    action: string;
    shares: number;
    price: number;
    trade_value: number;
    cash_after: number;
  }[];
  risk_review: RiskReview | null;
}

export interface BacktestPayload {
  summary: PerformanceSummary;
  equity_curve: { date: string; portfolio_value: number; cash?: number }[];
  trades: TickerDetail["trades"];
}

async function getJson<T>(path: string, server = true): Promise<T> {
  const res = await fetch(url(path, server), { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()) as T;
}

async function getText(path: string, server = true): Promise<string> {
  const res = await fetch(url(path, server), { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return await res.text();
}

export const api = {
  health: () => getJson<{ status: string; has_outputs: boolean }>("/api/health"),
  universe: () => getJson<UniversePayload>("/api/universe"),
  rankings: () => getJson<CompanyScoreRow[]>("/api/rankings"),
  ticker: (sym: string) => getJson<TickerDetail>(`/api/ticker/${sym}`),
  dashboard: () => getJson<DashboardPayload>("/api/dashboard"),
  memo: () => getText("/api/memo"),
  risk: () => getJson<RiskReport>("/api/risk"),
  backtest: () => getJson<BacktestPayload>("/api/backtest"),
};

// Client-side variant: kicks the pipeline + reloads the page on success.
export async function runPipelineFromBrowser(): Promise<void> {
  const res = await fetch("/api/run", { method: "POST" });
  if (!res.ok) throw new Error(`/api/run -> ${res.status}`);
}
