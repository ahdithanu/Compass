"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { buildAllocation } from "@/lib/allocate";
import { computeRebalance, BUCKETS, type Bucket } from "@/lib/rebalance";
import { DEFAULT_PROFILE } from "@/lib/profile";
import type { Allocation, Goal, JourneyStage, Profile, RiskTolerance } from "@/lib/types";

const BUCKET_META: Record<Bucket, { label: string; color: string }> = {
  stocks: { label: "Stocks", color: "var(--accent-dim)" },
  bonds: { label: "Bonds", color: "var(--chart-bonds)" },
  cash: { label: "Cash", color: "var(--chart-cash)" },
  alternatives: { label: "Alternatives", color: "var(--warn)" },
};

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function RebalancePage() {
  const [target, setTarget] = useState<Allocation>(() => buildAllocation(DEFAULT_PROFILE));
  const [fromProfile, setFromProfile] = useState(false);
  const [holdings, setHoldings] = useState<Record<Bucket, string>>({
    stocks: "",
    bonds: "",
    cash: "",
    alternatives: "",
  });

  // Pull the target from the user's saved profile (local stash, then the
  // authoritative DB row), matching the onboarding precedence.
  useEffect(() => {
    const stored =
      typeof window !== "undefined"
        ? sessionStorage.getItem("compass:profile")
        : null;
    if (stored) {
      try {
        const p = JSON.parse(stored) as Profile;
        setTarget(buildAllocation(p));
        setFromProfile(true);
      } catch {
        /* ignore a corrupt stash */
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
      if (!data) return;
      setTarget(
        buildAllocation({
          age: data.age,
          goal: data.goal as Goal,
          riskTolerance: data.risk_tolerance as RiskTolerance,
          horizonYears: data.horizon_years,
          journeyStage: data.journey_stage as JourneyStage,
          interests: data.interests ?? [],
        }),
      );
      setFromProfile(true);
    })();
  }, []);

  const plan = useMemo(() => {
    const current = Object.fromEntries(
      BUCKETS.map((b) => [b, Number(holdings[b]) || 0]),
    ) as Record<Bucket, number>;
    return computeRebalance(current, target);
  }, [holdings, target]);

  const trades = plan.rows.filter((r) => Math.abs(r.delta) >= 1);
  const hasMoney = plan.total > 0;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/dashboard" className="text-lg font-bold tracking-tight">
          Compass<span style={{ color: "var(--accent)" }}>.</span>
        </Link>
        <Link href="/dashboard" className="btn-ghost text-sm">
          Back to dashboard
        </Link>
      </header>

      <h1 className="text-3xl font-bold">Rebalance calculator</h1>
      <p className="mt-2" style={{ color: "var(--muted)" }}>
        Enter what you hold today. Compass compares it to your target mix and
        shows the trades that close the gap.{" "}
        {fromProfile ? (
          <span>Target is drawn from your profile.</span>
        ) : (
          <span>
            Using a default target —{" "}
            <Link href="/onboarding" className="underline" style={{ color: "var(--accent)" }}>
              set your profile
            </Link>{" "}
            to personalize it.
          </span>
        )}
      </p>

      {/* Inputs */}
      <section className="card mt-8 space-y-4 p-6">
        <p className="label">What you hold now</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {BUCKETS.map((b) => (
            <div key={b}>
              <label className="label flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: BUCKET_META[b].color }}
                />
                {BUCKET_META[b].label}
                <span style={{ color: "var(--muted)" }}> · target {target[b]}%</span>
              </label>
              <input
                className="input mt-1"
                type="number"
                min={0}
                inputMode="decimal"
                placeholder="$0"
                value={holdings[b]}
                onChange={(e) =>
                  setHoldings((h) => ({ ...h, [b]: e.target.value }))
                }
              />
            </div>
          ))}
        </div>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Portfolio total:{" "}
          <span className="font-semibold" style={{ color: "var(--text)" }}>
            {fmtUsd(plan.total)}
          </span>
        </p>
      </section>

      {/* Plan */}
      {hasMoney && (
        <section className="card mt-6 p-6">
          <div className="flex items-center justify-between">
            <p className="label">The plan</p>
            <DriftBadge balanced={plan.balanced} driftPct={plan.driftPct} />
          </div>

          {plan.balanced ? (
            <p className="mt-4 text-sm">
              You&apos;re on target — no trades needed. Nice.
            </p>
          ) : (
            <>
              <ul className="mt-4 space-y-2">
                {trades.map((r) => (
                  <li
                    key={r.bucket}
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-sm"
                    style={{ background: "var(--panel-2)" }}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="font-semibold"
                        style={{ color: r.delta > 0 ? "var(--accent)" : "var(--danger)" }}
                      >
                        {r.delta > 0 ? "Buy" : "Sell"}
                      </span>
                      <span className="font-medium">{BUCKET_META[r.bucket].label}</span>
                    </span>
                    <span className="font-semibold tabular-nums">
                      {fmtUsd(Math.abs(r.delta))}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
                Moves {plan.driftPct}% of the portfolio to reach your target mix.
              </p>
            </>
          )}

          {/* Detail table: current vs target per bucket */}
          <div className="mt-6 space-y-2">
            {plan.rows.map((r) => (
              <div key={r.bucket} className="text-sm">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: BUCKET_META[r.bucket].color }}
                    />
                    {BUCKET_META[r.bucket].label}
                  </span>
                  <span style={{ color: "var(--muted)" }}>
                    {r.currentPct}% → {r.targetPct}%{" "}
                    <span className="tabular-nums">
                      ({fmtUsd(r.current)} → {fmtUsd(r.target)})
                    </span>
                  </span>
                </div>
                {/* current vs target mini-bars */}
                <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
                  <div style={{ width: `${r.currentPct}%`, background: BUCKET_META[r.bucket].color }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="mt-6 px-2 text-xs" style={{ color: "var(--muted)" }}>
        Educational tool only — not investment advice. Rebalancing may have tax
        consequences; consider your own situation before trading.
      </p>
    </main>
  );
}

function DriftBadge({ balanced, driftPct }: { balanced: boolean; driftPct: number }) {
  const color = balanced ? "var(--accent)" : driftPct >= 15 ? "var(--danger)" : "var(--warn)";
  return (
    <span
      className="rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ background: "var(--panel-2)", color }}
    >
      {balanced ? "On target" : `${driftPct}% drift`}
    </span>
  );
}
