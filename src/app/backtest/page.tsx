"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { buildAllocation } from "@/lib/allocate";
import { DEFAULT_PROFILE } from "@/lib/profile";
import { apiPost, withRef } from "@/lib/apiClient";
import AccountMenu from "@/components/AccountMenu";
import type { Goal, JourneyStage, Profile, RiskTolerance } from "@/lib/types";

type Bucket = "stocks" | "bonds" | "cash" | "alternatives";
const BUCKETS: Bucket[] = ["stocks", "bonds", "cash", "alternatives"];
const META: Record<Bucket, { label: string; color: string }> = {
  stocks: { label: "Stocks", color: "var(--accent-dim)" },
  bonds: { label: "Bonds", color: "var(--chart-bonds)" },
  cash: { label: "Cash", color: "var(--chart-cash)" },
  alternatives: { label: "Alternatives", color: "var(--warn)" },
};

interface BtResult {
  startValue: number;
  endValue: number;
  totalReturnPct: number;
  annualizedReturnPct: number;
  maxDrawdownPct: number;
  points: { date: string; value: number }[];
}
interface BtResponse {
  portfolio: BtResult;
  benchmark: BtResult;
  source: "live" | "simulated";
  positions: { ticker: string; weight: number; amount: number }[];
  years: number;
}

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function BacktestPage() {
  const [weights, setWeights] = useState<Record<Bucket, number>>({
    stocks: 60,
    bonds: 30,
    cash: 5,
    alternatives: 5,
  });
  const [amount, setAmount] = useState(1000);
  const [years, setYears] = useState(3);
  const [res, setRes] = useState<BtResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the mix from the user's profile allocation.
  useEffect(() => {
    const applyProfile = (p: Profile) => {
      const a = buildAllocation(p);
      setWeights({ stocks: a.stocks, bonds: a.bonds, cash: a.cash, alternatives: a.alternatives });
    };
    const stored =
      typeof window !== "undefined" ? sessionStorage.getItem("compass:profile") : null;
    if (stored) {
      try {
        applyProfile(JSON.parse(stored) as Profile);
      } catch {
        applyProfile(DEFAULT_PROFILE);
      }
    }
    if (!isSupabaseConfigured()) return;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("age, goal, risk_tolerance, horizon_years, journey_stage, interests")
        .eq("id", user.id)
        .maybeSingle();
      if (data) {
        applyProfile({
          age: data.age,
          goal: data.goal as Goal,
          riskTolerance: data.risk_tolerance as RiskTolerance,
          horizonYears: data.horizon_years,
          journeyStage: data.journey_stage as JourneyStage,
          interests: data.interests ?? [],
        });
      }
    })();
  }, []);

  const total = BUCKETS.reduce((s, b) => s + (Number(weights[b]) || 0), 0);

  async function run() {
    setBusy(true);
    setError(null);
    const r = await apiPost<BtResponse>("/api/backtest", { weights, amount, years });
    setBusy(false);
    if (!r.ok) {
      setError(withRef(r.error, r.requestId));
      return;
    }
    setRes(r.data);
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/dashboard" className="text-lg font-bold tracking-tight">
          Compass<span style={{ color: "var(--accent)" }}>.</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/dashboard" className="btn-ghost text-sm">
            Back to dashboard
          </Link>
          <AccountMenu />
        </div>
      </header>

      <h1 className="text-3xl font-bold">Paper backtest</h1>
      <p className="mt-2" style={{ color: "var(--muted)" }}>
        Put fake money to work. Set a mix, pick a starting amount, and see how it
        would have grown over the last few years — no real money involved.
      </p>

      {/* Scenario inputs */}
      <section className="card mt-8 space-y-5 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="bt-amount">Starting amount</label>
            <input
              id="bt-amount"
              name="bt-amount"
              className="input mt-1"
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label" htmlFor="bt-years">Look back</label>
            <select
              id="bt-years"
              name="bt-years"
              className="select mt-1"
              value={years}
              onChange={(e) => setYears(Number(e.target.value))}
            >
              <option value={1}>1 year</option>
              <option value={3}>3 years</option>
              <option value={5}>5 years</option>
              <option value={10}>10 years</option>
            </select>
          </div>
        </div>

        <div>
          <span className="label" id="mix-label">Your mix — tweak it to test a hunch</span>
          <div className="mt-2 space-y-2" role="group" aria-labelledby="mix-label">
            {BUCKETS.map((b) => (
              <div key={b} className="flex items-center gap-3">
                <span className="flex w-28 items-center gap-1.5 text-sm">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: META[b].color }} aria-hidden="true" />
                  {META[b].label}
                </span>
                <input
                  className="flex-1"
                  type="range"
                  min={0}
                  max={100}
                  value={weights[b]}
                  aria-label={`${META[b].label} weight`}
                  aria-valuetext={`${weights[b]} percent`}
                  onChange={(e) => setWeights((w) => ({ ...w, [b]: Number(e.target.value) }))}
                />
                <span className="w-10 text-right text-sm font-semibold tabular-nums" aria-hidden="true">
                  {weights[b]}%
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs" style={{ color: total === 100 ? "var(--muted)" : "var(--warn)" }}>
            Total {total}% {total !== 100 && "— weights are normalized when you run."}
          </p>
        </div>

        {error && (
          <p className="text-sm" role="alert" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
        <button className="btn w-full" disabled={busy || total <= 0} onClick={run}>
          {busy ? "Running…" : "Run backtest"}
        </button>
      </section>

      {res && <Results res={res} />}

      <p className="mt-6 px-2 text-xs" style={{ color: "var(--muted)" }}>
        Past performance doesn&apos;t predict future results. Educational only —
        not investment advice.
      </p>
    </main>
  );
}

function Results({ res }: { res: BtResponse }) {
  const { portfolio: p, benchmark: bm, source } = res;
  const beat = p.totalReturnPct - bm.totalReturnPct;

  return (
    <section className="card mt-6 p-6">
      <div className="flex items-center justify-between">
        <p className="label">Result over {res.years} {res.years === 1 ? "year" : "years"}</p>
        <span
          className="rounded-full px-2.5 py-1 text-xs font-semibold"
          style={{ background: "var(--panel-2)", color: source === "live" ? "var(--accent)" : "var(--muted)" }}
          title={source === "live" ? "Real market history" : "Simulated market — add a market-data key for real history"}
        >
          {source === "live" ? "live history" : "simulated"}
        </span>
      </div>

      <p className="mt-2 text-4xl font-extrabold tracking-tight">{fmtUsd(p.endValue)}</p>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
        from {fmtUsd(p.startValue)} ·{" "}
        <span style={{ color: p.totalReturnPct >= 0 ? "var(--accent)" : "var(--danger)" }}>
          {p.totalReturnPct >= 0 ? "+" : ""}{p.totalReturnPct}%
        </span>{" "}
        total · {p.annualizedReturnPct}%/yr
      </p>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <Stat label="Annualized" value={`${p.annualizedReturnPct}%`} />
        <Stat label="Max drawdown" value={`-${p.maxDrawdownPct}%`} danger />
        <Stat
          label="vs benchmark"
          value={`${beat >= 0 ? "+" : ""}${Math.round(beat)}%`}
          danger={beat < 0}
        />
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-center gap-4 text-xs" style={{ color: "var(--muted)" }}>
          <Legend color="var(--accent-dim)" label="Your mix" />
          <Legend color="var(--muted)" label="100% stocks (benchmark)" />
        </div>
        <GrowthLines portfolio={p.points} benchmark={bm.points} />
      </div>

      <div className="mt-6">
        <p className="label mb-2">Positions</p>
        <ul className="space-y-1 text-sm">
          {res.positions.map((pos) => (
            <li key={pos.ticker} className="flex items-center justify-between">
              <span className="font-medium">{pos.ticker}</span>
              <span style={{ color: "var(--muted)" }}>
                {pos.weight}% · {fmtUsd(pos.amount)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function GrowthLines({
  portfolio,
  benchmark,
}: {
  portfolio: { value: number }[];
  benchmark: { value: number }[];
}) {
  const all = [...portfolio, ...benchmark].map((p) => p.value);
  const max = Math.max(...all, 1);
  const min = Math.min(...all, max);
  const pad = (max - min) * 0.08 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const path = (pts: { value: number }[]) =>
    pts
      .map((p, i) => {
        const x = pts.length > 1 ? (i / (pts.length - 1)) * 100 : 0;
        const y = 40 - ((p.value - lo) / (hi - lo)) * 40;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

  const endP = portfolio.at(-1)?.value;
  const endB = benchmark.at(-1)?.value;
  return (
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      className="h-40 w-full"
      role="img"
      aria-label={
        endP != null && endB != null
          ? `Your mix ended at ${Math.round(endP)}, the benchmark at ${Math.round(endB)}.`
          : "Portfolio value versus benchmark over time."
      }
    >
      <path
        d={path(benchmark)}
        fill="none"
        stroke="var(--muted)"
        strokeWidth={0.6}
        strokeDasharray="1.5 1.5"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={path(portfolio)}
        fill="none"
        stroke="var(--accent-dim)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-xl p-3" style={{ background: "var(--panel-2)" }}>
      <p className="text-xs" style={{ color: "var(--muted)" }}>{label}</p>
      <p className="text-lg font-extrabold tabular-nums" style={danger ? { color: "var(--danger)" } : undefined}>
        {value}
      </p>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
