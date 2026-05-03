import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { Card, Stat } from "@/components/Card";
import { RatingBadge, ScoreBadge, FlagPill } from "@/components/Badge";
import { PillarBars } from "@/components/PillarBars";

const fmtFrac = (v?: number | null) =>
  v == null ? "—" : `${(v * 100).toFixed(1)}%`;

const ACTION_TONE: Record<string, string> = {
  OPEN_LONG: "text-emerald-300",
  ADD: "text-emerald-300",
  TRIM: "text-amber-300",
  CLOSE: "text-rose-300",
  REJECT: "text-rose-300",
};

export default async function TickerPage({
  params,
}: {
  params: { symbol: string };
}) {
  const sym = params.symbol.toUpperCase();
  let detail;
  try {
    detail = await api.ticker(sym);
  } catch {
    notFound();
  }

  const s = detail.scores;
  const review = detail.risk_review;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold font-mono tracking-tight">
            {detail.ticker}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            <Link href="/rankings" className="text-accent-500 hover:underline">
              ← Rankings
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <RatingBadge rating={s.rating} />
          <span className="text-2xl">
            <ScoreBadge score={s.signal_score} />
            <span className="text-slate-500 text-base ml-1">/100</span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Momentum" value={fmtFrac(s.momentum)} />
        <Stat label="Volatility" value={fmtFrac(s.volatility)} />
        <Stat label="Drawdown" value={fmtFrac(s.drawdown)} />
        <Stat label="Rel. strength" value={fmtFrac(s.rel_strength)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Per-pillar score">
          <PillarBars row={s} />
        </Card>
        <Card title="Fundamentals snapshot">
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between">
              <span className="text-slate-400">Revenue growth (YoY)</span>
              <span>{fmtFrac(s.revenue_growth_yoy)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-slate-400">Operating margin</span>
              <span>{fmtFrac(s.operating_margin)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-slate-400">P/E (trailing)</span>
              <span>
                {s.pe_ratio == null ? "—" : s.pe_ratio.toFixed(1) + "x"}
              </span>
            </li>
            <li className="flex justify-between">
              <span className="text-slate-400">News events on file</span>
              <span>{s.n_events ?? 0}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-slate-400">Alt-data signals</span>
              <span>{s.n_signals ?? 0}</span>
            </li>
          </ul>
        </Card>
      </div>

      <Card title="Risk review">
        {review ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`text-xs font-semibold ${
                  review.approved ? "text-emerald-300" : "text-rose-300"
                }`}
              >
                {review.approved ? "APPROVED" : "REJECTED"}
              </span>
              <span className="text-slate-400">
                Suggested weight:{" "}
                <span className="text-slate-100">
                  {(review.suggested_weight_pct * 100).toFixed(1)}%
                </span>
              </span>
              <div className="flex gap-1 flex-wrap">
                {review.flags.map((f) => (
                  <FlagPill key={f} label={f} />
                ))}
              </div>
            </div>
            {review.notes.length > 0 && (
              <ul className="list-disc list-inside text-slate-300 space-y-1">
                {review.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No risk review available.</p>
        )}
      </Card>

      <Card title="Trade log" subtitle="Simulated rebalance legs">
        {detail.trades.length === 0 ? (
          <p className="text-sm text-slate-500">
            No trades for this ticker (likely never BUY-rated this cycle).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Action</th>
                  <th className="px-2 py-2">Shares</th>
                  <th className="px-2 py-2">Price</th>
                  <th className="px-2 py-2">Trade $</th>
                  <th className="px-2 py-2">Cash after</th>
                </tr>
              </thead>
              <tbody>
                {detail.trades.map((t, i) => (
                  <tr
                    key={i}
                    className="border-t border-ink-600 hover:bg-ink-700/40"
                  >
                    <td className="px-2 py-2 font-mono text-xs">{t.date}</td>
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
        )}
      </Card>
    </div>
  );
}
