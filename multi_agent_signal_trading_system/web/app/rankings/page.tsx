import Link from "next/link";
import { api } from "@/lib/api";
import { Card } from "@/components/Card";
import { RatingBadge, ScoreBadge } from "@/components/Badge";

const fmtFrac = (v?: number | null) =>
  v == null ? "—" : `${(v * 100).toFixed(1)}%`;

export default async function RankingsPage() {
  const rows = await api.rankings();
  const sorted = [...rows].sort((a, b) => b.signal_score - a.signal_score);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Company rankings</h1>
        <p className="text-sm text-slate-400 mt-1">
          Composite signal score (0–100) per ticker, with the per-pillar
          contributions and key market features. Click a ticker for the
          drill-down.
        </p>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-400 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-2 py-2">Rank</th>
                <th className="px-2 py-2">Ticker</th>
                <th className="px-2 py-2">Rating</th>
                <th className="px-2 py-2">Signal</th>
                <th className="px-2 py-2">Market</th>
                <th className="px-2 py-2">News</th>
                <th className="px-2 py-2">Fundamentals</th>
                <th className="px-2 py-2">Alt-data</th>
                <th className="px-2 py-2 hidden md:table-cell">Momentum</th>
                <th className="px-2 py-2 hidden md:table-cell">Vol</th>
                <th className="px-2 py-2 hidden lg:table-cell">Rev growth</th>
                <th className="px-2 py-2 hidden lg:table-cell">P/E</th>
                <th className="px-2 py-2 hidden lg:table-cell">Events</th>
                <th className="px-2 py-2 hidden lg:table-cell">Alt sigs</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <tr
                  key={row.ticker}
                  className="border-t border-ink-600 hover:bg-ink-700/40"
                >
                  <td className="px-2 py-2 text-slate-500">{i + 1}</td>
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
                  <td className="px-2 py-2">{row.market_score?.toFixed(2)}</td>
                  <td className="px-2 py-2">{row.news_score?.toFixed(2)}</td>
                  <td className="px-2 py-2">{row.fundamental_score?.toFixed(2)}</td>
                  <td className="px-2 py-2">{row.alt_score?.toFixed(2)}</td>
                  <td className="px-2 py-2 hidden md:table-cell">
                    {fmtFrac(row.momentum)}
                  </td>
                  <td className="px-2 py-2 hidden md:table-cell">
                    {fmtFrac(row.volatility)}
                  </td>
                  <td className="px-2 py-2 hidden lg:table-cell">
                    {fmtFrac(row.revenue_growth_yoy)}
                  </td>
                  <td className="px-2 py-2 hidden lg:table-cell">
                    {row.pe_ratio == null ? "—" : row.pe_ratio.toFixed(0) + "x"}
                  </td>
                  <td className="px-2 py-2 hidden lg:table-cell">
                    {row.n_events ?? "—"}
                  </td>
                  <td className="px-2 py-2 hidden lg:table-cell">
                    {row.n_signals ?? "—"}
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
