import Link from "next/link";
import { api } from "@/lib/api";
import { Card, Stat } from "@/components/Card";
import { RatingBadge, ScoreBadge, FlagPill } from "@/components/Badge";
import { EquityCurve } from "@/components/EquityCurve";

const fmtPct = (v?: number | null, digits = 1) =>
  v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(digits)}%`;
const fmtFrac = (v?: number | null) =>
  v == null ? "—" : `${(v * 100).toFixed(1)}%`;

export default async function DashboardPage() {
  let dash, universe;
  try {
    [dash, universe] = await Promise.all([api.dashboard(), api.universe()]);
  } catch (e) {
    return (
      <Card title="Backend not available">
        <p className="text-slate-300 mb-2">
          The API at <code>/api/dashboard</code> is not responding. Start the
          backend with:
        </p>
        <pre className="bg-ink-700 rounded p-3 text-xs overflow-auto">
{`cd ..
uvicorn multi_agent_investment_research_engine.api.main:app --reload --port 8000

# Then run the pipeline once if you have not already:
python -m multi_agent_investment_research_engine.main`}
        </pre>
        <p className="mt-2 text-xs text-slate-500">{(e as Error).message}</p>
      </Card>
    );
  }

  const perf = dash.performance;
  const snap = dash.portfolio_snapshot;
  const totalTone = perf.total_return_pct >= 0 ? "good" : "bad";
  const ddTone = perf.max_drawdown_pct < -10 ? "bad" : "neutral";

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Portfolio dashboard</h1>
          <p className="text-sm text-slate-400 mt-1">
            As of <span className="text-slate-200">{dash.as_of}</span> · Universe{" "}
            <span className="text-slate-200">{universe.universe.join(", ")}</span> · Benchmark{" "}
            <span className="text-slate-200">{universe.benchmark}</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat
          label="Total return"
          value={fmtPct(perf.total_return_pct)}
          tone={totalTone}
          delta={`bench ${fmtPct(perf.benchmark_return_pct)}`}
        />
        <Stat
          label="Max drawdown"
          value={fmtPct(perf.max_drawdown_pct)}
          tone={ddTone}
        />
        <Stat
          label="Win rate"
          value={fmtPct(perf.win_rate_pct, 0)}
          delta={`${perf.num_trades} trades`}
        />
        <Stat label="Sharpe-like" value={perf.sharpe_like.toFixed(2)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card
          title="Equity curve"
          subtitle={`${perf.start_date} → ${perf.end_date} · weekly rebalance · paper trading`}
        >
          <div className="lg:col-span-2">
            <EquityCurve data={dash.equity_curve} />
          </div>
        </Card>
        <Card title="Portfolio snapshot" subtitle="Latest risk readout">
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between">
              <span className="text-slate-400">Cash</span>
              <span>{fmtFrac(snap.cash_pct)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-slate-400">Top single name</span>
              <span>{fmtFrac(snap.concentration_pct_top)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-slate-400">Vol (proxy)</span>
              <span>{fmtFrac(snap.portfolio_volatility)}</span>
            </li>
            <li>
              <span className="text-slate-400 block mb-1">Flags</span>
              <div className="flex flex-wrap gap-1">
                {snap.flags.length === 0 ? (
                  <span className="text-xs text-slate-500">none</span>
                ) : (
                  snap.flags.map((f) => <FlagPill key={f} label={f} />)
                )}
              </div>
            </li>
          </ul>
        </Card>
      </div>

      <Card
        title="Top picks"
        subtitle="Highest composite signal scores this cycle"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-400 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-2 py-2">Ticker</th>
                <th className="px-2 py-2">Rating</th>
                <th className="px-2 py-2">Signal</th>
                <th className="px-2 py-2 hidden md:table-cell">Market</th>
                <th className="px-2 py-2 hidden md:table-cell">News</th>
                <th className="px-2 py-2 hidden md:table-cell">Fundamentals</th>
                <th className="px-2 py-2 hidden md:table-cell">Alt-data</th>
                <th className="px-2 py-2 hidden lg:table-cell">Vol</th>
                <th className="px-2 py-2 hidden lg:table-cell">Drawdown</th>
              </tr>
            </thead>
            <tbody>
              {dash.top_picks.map((row) => (
                <tr
                  key={row.ticker}
                  className="border-t border-ink-600 hover:bg-ink-700/40"
                >
                  <td className="px-2 py-2 font-mono">
                    <Link
                      href={`/ticker/${row.ticker}`}
                      className="text-accent-500 hover:underline"
                    >
                      {row.ticker}
                    </Link>
                  </td>
                  <td className="px-2 py-2">
                    <RatingBadge rating={row.rating} />
                  </td>
                  <td className="px-2 py-2">
                    <ScoreBadge score={row.signal_score} />
                  </td>
                  <td className="px-2 py-2 hidden md:table-cell">{row.market_score?.toFixed(2)}</td>
                  <td className="px-2 py-2 hidden md:table-cell">{row.news_score?.toFixed(2)}</td>
                  <td className="px-2 py-2 hidden md:table-cell">{row.fundamental_score?.toFixed(2)}</td>
                  <td className="px-2 py-2 hidden md:table-cell">{row.alt_score?.toFixed(2)}</td>
                  <td className="px-2 py-2 hidden lg:table-cell">{fmtFrac(row.volatility)}</td>
                  <td className="px-2 py-2 hidden lg:table-cell">{fmtFrac(row.drawdown)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
