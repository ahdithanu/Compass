import Link from "next/link";
import { api } from "@/lib/api";
import { Card, Stat } from "@/components/Card";
import { FlagPill } from "@/components/Badge";

const fmtFrac = (v?: number | null) =>
  v == null ? "—" : `${(v * 100).toFixed(1)}%`;

export default async function RiskPage() {
  const r = await api.risk();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Risk report</h1>
        <p className="text-sm text-slate-400 mt-1">
          Output of the RiskAgent. Caps, vol trims, drawdown flags, and
          per-ticker reviews for the latest cycle.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="As of" value={r.as_of} />
        <Stat label="Cash" value={fmtFrac(r.cash_pct)} />
        <Stat label="Top single name" value={fmtFrac(r.concentration_pct_top)} />
        <Stat label="Vol (proxy)" value={fmtFrac(r.portfolio_volatility)} />
      </div>

      <Card title="Portfolio-level flags">
        <div className="flex flex-wrap gap-2">
          {r.flags.length === 0 ? (
            <span className="text-sm text-slate-500">none</span>
          ) : (
            r.flags.map((f) => <FlagPill key={f} label={f} />)
          )}
        </div>
      </Card>

      <Card title="Per-ticker risk reviews" subtitle="Approved / suggested weight / flags / notes">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-400 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-2 py-2">Ticker</th>
                <th className="px-2 py-2">Approved</th>
                <th className="px-2 py-2">Weight</th>
                <th className="px-2 py-2">Flags</th>
                <th className="px-2 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {r.per_ticker.map((t) => (
                <tr key={t.ticker} className="border-t border-ink-600 hover:bg-ink-700/40 align-top">
                  <td className="px-2 py-2 font-mono">
                    <Link
                      href={`/ticker/${t.ticker}`}
                      className="text-accent-500 hover:underline"
                    >
                      {t.ticker}
                    </Link>
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className={`text-xs font-semibold ${
                        t.approved ? "text-emerald-300" : "text-rose-300"
                      }`}
                    >
                      {t.approved ? "yes" : "no"}
                    </span>
                  </td>
                  <td className="px-2 py-2">{(t.suggested_weight_pct * 100).toFixed(1)}%</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      {t.flags.length === 0 ? (
                        <span className="text-xs text-slate-500">—</span>
                      ) : (
                        t.flags.map((f) => <FlagPill key={f} label={f} />)
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-slate-300">
                    {t.notes.length === 0 ? (
                      <span className="text-slate-500">—</span>
                    ) : (
                      <ul className="list-disc list-inside space-y-1">
                        {t.notes.map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                      </ul>
                    )}
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
