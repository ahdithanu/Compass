"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { buildAllocation } from "@/lib/allocate";
import { expectedReturn, scenarios, requiredMonthlyContribution } from "@/lib/project";
import { DEFAULT_PROFILE } from "@/lib/profile";
import AccountMenu from "@/components/AccountMenu";
import type { Allocation, Goal, JourneyStage, Profile, RiskTolerance } from "@/lib/types";

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function ProjectionPage() {
  const [alloc, setAlloc] = useState<Allocation>(() => buildAllocation(DEFAULT_PROFILE));
  const [fromProfile, setFromProfile] = useState(false);
  const [startingBalance, setStarting] = useState(10000);
  const [monthly, setMonthly] = useState(500);
  const [years, setYears] = useState(20);
  const [goalAmount, setGoal] = useState<number | "">("");

  // Pull profile (local stash, then DB) to seed the allocation + inputs.
  useEffect(() => {
    const applyProfile = (p: Profile) => {
      setAlloc(buildAllocation(p));
      setFromProfile(true);
      if (typeof p.horizonYears === "number" && p.horizonYears > 0) setYears(p.horizonYears);
      if (typeof p.monthlyContribution === "number" && p.monthlyContribution > 0) {
        setMonthly(p.monthlyContribution);
      }
    };

    const stored =
      typeof window !== "undefined" ? sessionStorage.getItem("compass:profile") : null;
    if (stored) {
      try {
        applyProfile(JSON.parse(stored) as Profile);
      } catch {
        /* ignore */
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
        .select("age, goal, risk_tolerance, horizon_years, journey_stage, monthly_contribution, interests")
        .eq("id", user.id)
        .maybeSingle();
      if (!data) return;
      applyProfile({
        age: data.age,
        goal: data.goal as Goal,
        riskTolerance: data.risk_tolerance as RiskTolerance,
        horizonYears: data.horizon_years,
        journeyStage: data.journey_stage as JourneyStage,
        monthlyContribution: data.monthly_contribution ?? undefined,
        interests: data.interests ?? [],
      });
    })();
  }, []);

  const annual = useMemo(() => expectedReturn(alloc), [alloc]);
  const projs = useMemo(
    () => scenarios({ startingBalance, monthlyContribution: monthly, years }, annual),
    [startingBalance, monthly, years, annual],
  );

  const expected = projs.expected;
  const onTrack = goalAmount !== "" && expected.finalBalance >= Number(goalAmount);
  const gap = goalAmount === "" ? 0 : Number(goalAmount) - expected.finalBalance;
  // If short, what monthly contribution would actually close the gap?
  const requiredMonthly =
    goalAmount !== "" && !onTrack
      ? requiredMonthlyContribution(Number(goalAmount), startingBalance, years, annual)
      : 0;

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

      <h1 className="text-3xl font-bold">Will you hit your number?</h1>
      <p className="mt-2" style={{ color: "var(--muted)" }}>
        A projection of where steady investing could take you, compounded at the
        blended return of your target mix.{" "}
        {fromProfile ? (
          <span>Seeded from your profile.</span>
        ) : (
          <span>
            Using defaults —{" "}
            <Link href="/onboarding" className="underline" style={{ color: "var(--accent)" }}>
              set your profile
            </Link>{" "}
            to personalize.
          </span>
        )}
      </p>

      {/* Inputs */}
      <section className="card mt-8 space-y-5 p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Starting balance">
            <input
              className="input mt-1"
              type="number"
              min={0}
              value={startingBalance}
              onChange={(e) => setStarting(Number(e.target.value))}
            />
          </Field>
          <Field label="Monthly contribution">
            <input
              className="input mt-1"
              type="number"
              min={0}
              value={monthly}
              onChange={(e) => setMonthly(Number(e.target.value))}
            />
          </Field>
          <Field label="Years">
            <input
              className="input mt-1"
              type="number"
              min={1}
              max={60}
              value={years}
              onChange={(e) => setYears(Number(e.target.value))}
            />
          </Field>
          <Field label="Goal amount (optional)">
            <input
              className="input mt-1"
              type="number"
              min={0}
              placeholder="e.g. 1,000,000"
              value={goalAmount}
              onChange={(e) => setGoal(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </Field>
        </div>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Blended expected return: <strong>{(annual * 100).toFixed(1)}%</strong>/yr from your{" "}
          {alloc.stocks}/{alloc.bonds}/{alloc.cash}/{alloc.alternatives} mix
          (stocks/bonds/cash/alts).
        </p>
      </section>

      {/* Headline result */}
      <section className="card mt-6 p-6">
        <div className="flex items-baseline justify-between gap-3">
          <p className="label">Projected in {years} years</p>
          {goalAmount !== "" && (
            <span
              className="rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{
                background: "var(--panel-2)",
                color: onTrack ? "var(--accent)" : "var(--warn)",
              }}
            >
              {onTrack ? "On track" : `${fmtUsd(Math.abs(gap))} short`}
            </span>
          )}
        </div>
        <p className="mt-2 text-4xl font-extrabold tracking-tight">
          {fmtUsd(expected.finalBalance)}
        </p>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Range {fmtUsd(projs.conservative.finalBalance)} –{" "}
          {fmtUsd(projs.optimistic.finalBalance)} (±2% return)
        </p>

        {/* Contributed vs growth split */}
        <div className="mt-5">
          <div className="flex h-3 w-full overflow-hidden rounded-full">
            <div
              style={{
                width: `${pct(startingBalance + expected.totalContributed, expected.finalBalance)}%`,
                background: "var(--chart-cash)",
              }}
            />
            <div style={{ flex: 1, background: "var(--accent-dim)" }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <Legend color="var(--chart-cash)" label="You put in" value={fmtUsd(startingBalance + expected.totalContributed)} />
            <Legend color="var(--accent-dim)" label="Compounding growth" value={fmtUsd(expected.growth)} />
          </div>
        </div>

        {/* Reverse-solver: the actionable nudge when you're short of the goal. */}
        {requiredMonthly > 0 && (
          <div
            className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl p-4"
            style={{ background: "var(--panel-2)" }}
          >
            <p className="text-sm">
              To reach {fmtUsd(Number(goalAmount))}, contribute{" "}
              <span className="font-bold" style={{ color: "var(--accent)" }}>
                {fmtUsd(requiredMonthly)}/mo
              </span>{" "}
              <span style={{ color: "var(--muted)" }}>
                (+{fmtUsd(Math.max(0, requiredMonthly - monthly))} from today&apos;s {fmtUsd(monthly)})
              </span>
            </p>
            <button className="btn text-sm" onClick={() => setMonthly(requiredMonthly)}>
              Apply
            </button>
          </div>
        )}
      </section>

      {/* Year-by-year chart */}
      {expected.points.length > 1 && (
        <section className="card mt-6 p-6">
          <p className="label mb-4">Growth over time</p>
          <GrowthChart
            points={expected.points}
            max={projs.optimistic.finalBalance}
          />
        </section>
      )}

      <p className="mt-6 px-2 text-xs" style={{ color: "var(--muted)" }}>
        Educational projection only — not a guarantee or investment advice.
        Returns are illustrative long-run assumptions; real markets vary widely
        and can lose money. Figures are nominal (not inflation-adjusted).
      </p>
    </main>
  );
}

function GrowthChart({
  points,
  max,
}: {
  points: { year: number; balance: number; invested: number }[];
  max: number;
}) {
  const safeMax = max > 0 ? max : 1;
  return (
    <div>
      <div className="flex h-40 items-end gap-1">
        {points.map((p) => {
          const h = Math.max(2, (p.balance / safeMax) * 100);
          const investedH = (p.invested / Math.max(p.balance, 1)) * 100;
          return (
            <div
              key={p.year}
              className="group relative flex-1"
              style={{ height: "100%" }}
              title={`Year ${p.year}: ${p.balance.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`}
            >
              <div
                className="absolute bottom-0 w-full overflow-hidden rounded-t"
                style={{ height: `${h}%`, background: "var(--accent-dim)" }}
              >
                {/* invested portion shaded at the base */}
                <div
                  className="absolute bottom-0 w-full"
                  style={{ height: `${investedH}%`, background: "var(--chart-cash)" }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs" style={{ color: "var(--muted)" }}>
        <span>Now</span>
        <span>Year {points.at(-1)!.year}</span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}
