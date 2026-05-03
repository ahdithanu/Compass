import { api } from "@/lib/api";
import { Card, Stat } from "@/components/Card";
import { EquityCurve } from "@/components/EquityCurve";

const fmtPct = (v?: number | null, digits = 1) =>
  v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(digits)}%`;

const ACTION_TONE: Record<string, string> = {
  OPEN_LONG: "text-emerald-300",
  ADD: "text-emerald-300",
  TRIM: "text-amber-300",
  CLOSE: "text-rose-300",
};

export default async function BacktestPage() {
  const bt = await api.backtest();
  const eq = bt.equity_curve.map((p) => ({
    date: p.date,
    value: p.portfolio_value,
  }));
  const perf = bt.summary;

  // Tail of trade log so the page doesn't render hundreds of rows.
  const recent = bt.trades.slice(-25).reverse();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Paper-trading backtest</h1>
        <p className="text-sm text-slate-400 mt-1">
          Weekly rebalance over the price history. Composite signal scores are
          recomputed at every Friday close from the same agents that run the
          live recommendation.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat
          label="Total return"
          value={fmtPct(perf.total_return_pct)}
          tone={perf.total_return_pct >= 0 ? "good" : "bad"}
          delta={`bench ${fmtPct(perf.benchmark_return_pct)}`}
        />
        <Stat
          label="Max drawdown"
          value={fmtPct(perf.max_drawdown_pct)}
          tone="bad"
        />
        <Stat label="Win rate" value={fmtPct(perf.win_rate_pct, 0)} />
        <Stat label="Sharpe-like" value={perf.sharpe_like.toFixed(2)} />
      </div>

      <Card
        title="Equity curve"
        subtitle={`${perf.start_date} → ${perf.end_date} · ${perf.num_trades} trades`}
      >
        <EquityCurve data={eq} />
      </Card>

      <Card title="Recent trades" subtitle="Last 25 simulated rebalance legs">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-400 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">Ticker</th>
                <th className="px-2 py-2">Action</th>
                <th className="px-2 py-2">Shares</th>
                <th className="px-2 py-2">Price</th>
                <th className="px-2 py-2">Trade $</th>
                <th className="px-2 py-2">Cash after</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((t, i) => (
                <tr
                  key={i}
                  className="border-t border-ink-600 hover:bg-ink-700/40"
                >
                  <td className="px-2 py-2 font-mono text-xs">{t.date}</td>
                  <td className="px-2 py-2 font-mono">{t.ticker}</td>
                  <td className={`px-2 py-2 font-semibold ${ACTION_TONE[t.action] ?? ""}`}>
                    {t.action}
                  </td>
                  <td className="px-2 py-2">{t.shares.toFixed(2)}</td>
                  <td className="px-2 py-2">${t.price.toFixed(2)}</td>
                  <td className="px-2 py-2">${t.trade_value.toFixed(0)}</td>
                  <td className="px-2 py-2 text-slate-400">
                    ${t.cash_after.toFixed(0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
