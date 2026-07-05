"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { buildAllocation } from "@/lib/allocate";
import { validateProfile } from "@/lib/validate";
import type { Goal, JourneyStage, Profile, RiskTolerance } from "@/lib/types";

const GOALS: { value: Goal; label: string }[] = [
  { value: "retirement", label: "Retirement" },
  { value: "growth", label: "Long-term growth" },
  { value: "income", label: "Income" },
  { value: "preservation", label: "Preserve capital" },
  { value: "short_term", label: "A short-term goal" },
];
const RISKS: { value: RiskTolerance; label: string; hint: string }[] = [
  { value: "conservative", label: "Conservative", hint: "Smoother ride, lower highs" },
  { value: "moderate", label: "Moderate", hint: "A balanced middle" },
  { value: "aggressive", label: "Aggressive", hint: "More stocks, more swings" },
];
const STAGES: { value: JourneyStage; label: string }[] = [
  { value: "just_starting", label: "Just starting out" },
  { value: "building", label: "Building" },
  { value: "established", label: "Established" },
  { value: "nearing_goal", label: "Nearing my goal" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [age, setAge] = useState(30);
  const [goal, setGoal] = useState<Goal>("growth");
  const [riskTolerance, setRisk] = useState<RiskTolerance>("moderate");
  const [horizonYears, setHorizon] = useState(20);
  const [journeyStage, setStage] = useState<JourneyStage>("building");
  const [monthlyContribution, setMonthly] = useState<number | "">("");
  const [interestsText, setInterests] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill from the saved profile so "Update my profile" shows current values,
  // not defaults. Prefer the authoritative DB row; fall back to the local stash.
  useEffect(() => {
    const apply = (p: Partial<Profile>) => {
      if (typeof p.age === "number") setAge(p.age);
      if (p.goal) setGoal(p.goal);
      if (p.riskTolerance) setRisk(p.riskTolerance);
      if (typeof p.horizonYears === "number") setHorizon(p.horizonYears);
      if (p.journeyStage) setStage(p.journeyStage);
      if (typeof p.monthlyContribution === "number") setMonthly(p.monthlyContribution);
      if (Array.isArray(p.interests)) setInterests(p.interests.join(", "));
    };

    const stored =
      typeof window !== "undefined"
        ? sessionStorage.getItem("compass:profile")
        : null;
    if (stored) {
      try {
        apply(JSON.parse(stored));
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
        .select(
          "age, goal, risk_tolerance, horizon_years, journey_stage, monthly_contribution, interests",
        )
        .eq("id", user.id)
        .maybeSingle();
      if (!data) return;
      apply({
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

  // Live preview of how the inputs map to an asset mix — the same deterministic
  // allocator the pipeline uses, so what you see here is what you'll get.
  const previewAlloc = useMemo(
    () =>
      buildAllocation({
        age: Number(age) || 0,
        goal,
        riskTolerance,
        horizonYears: Number(horizonYears) || 0,
        journeyStage,
        interests: [],
      }),
    [age, goal, riskTolerance, horizonYears, journeyStage],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const interests = interestsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const profile = {
      age: Number(age),
      goal,
      riskTolerance,
      horizonYears: Number(horizonYears),
      journeyStage,
      monthlyContribution:
        monthlyContribution === "" ? undefined : Number(monthlyContribution),
      interests,
    };

    // Validate here — the same gate the pipeline uses — so a bad value (e.g. a
    // non-numeric age) is caught with a clear message instead of surfacing as an
    // opaque "Profile failed validation" on the dashboard two steps later.
    const v = validateProfile(profile);
    if (!v.ok) {
      setBusy(false);
      setError(v.issues.join(" "));
      return;
    }

    // Persist to Supabase if the user is signed in; always stash locally so the
    // dashboard can render immediately (and demo mode works without auth).
    if (isSupabaseConfigured()) {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("profiles").upsert({
            id: user.id,
            age: profile.age,
            goal: profile.goal,
            risk_tolerance: profile.riskTolerance,
            horizon_years: profile.horizonYears,
            journey_stage: profile.journeyStage,
            monthly_contribution: profile.monthlyContribution ?? null,
            interests: profile.interests,
            updated_at: new Date().toISOString(),
          });
        }
      } catch {
        // Non-fatal — fall back to the local profile for this session.
      }
    }

    sessionStorage.setItem("compass:profile", JSON.stringify(profile));
    setBusy(false);
    router.push("/dashboard");
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <Link href="/" className="text-lg font-bold tracking-tight">
        Compass<span style={{ color: "var(--accent)" }}>.</span>
      </Link>

      <h1 className="mt-8 text-3xl font-bold">Tell Compass about you</h1>
      <p className="mt-2" style={{ color: "var(--muted)" }}>
        This shapes everything. Watch your target mix update as you choose — you
        can change any of it later and your plan re-tunes instantly.
      </p>

      <form onSubmit={submit} className="card mt-8 space-y-6 p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="label">Age</label>
            <input
              className="input mt-1"
              type="number"
              min={18}
              max={100}
              value={age}
              onChange={(e) => setAge(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Horizon (years)</label>
            <input
              className="input mt-1"
              type="number"
              min={0}
              max={70}
              value={horizonYears}
              onChange={(e) => setHorizon(Number(e.target.value))}
            />
          </div>
        </div>

        <div>
          <label className="label">Primary goal</label>
          <select
            className="select mt-1"
            value={goal}
            onChange={(e) => setGoal(e.target.value as Goal)}
          >
            {GOALS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Risk tolerance</label>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {RISKS.map((r) => {
              const active = r.value === riskTolerance;
              return (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRisk(r.value)}
                  className="lift rounded-xl px-3 py-3 text-left transition"
                  style={{
                    background: active ? "var(--accent)" : "var(--panel-2)",
                    color: active ? "#fff" : "var(--text)",
                    boxShadow: active ? "none" : "inset 0 0 0 1px var(--border)",
                  }}
                >
                  <span className="block text-sm font-semibold">{r.label}</span>
                  <span
                    className="mt-0.5 block text-xs"
                    style={{ color: active ? "rgba(255,255,255,0.85)" : "var(--muted)" }}
                  >
                    {r.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="label">Where are you in your journey?</label>
          <select
            className="select mt-1"
            value={journeyStage}
            onChange={(e) => setStage(e.target.value as JourneyStage)}
          >
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Monthly contribution (optional)</label>
          <input
            className="input mt-1"
            type="number"
            min={0}
            placeholder="e.g. 500"
            value={monthlyContribution}
            onChange={(e) =>
              setMonthly(e.target.value === "" ? "" : Number(e.target.value))
            }
          />
        </div>

        <div>
          <label className="label">Interests / themes (comma-separated)</label>
          <input
            className="input mt-1"
            placeholder="AI, clean energy, dividends"
            value={interestsText}
            onChange={(e) => setInterests(e.target.value)}
          />
        </div>

        {/* Live allocation preview — instant feedback that choices matter. */}
        <AllocationPreview alloc={previewAlloc} />

        {error && (
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        <button className="btn w-full" disabled={busy}>
          {busy ? "Building your plan…" : "Generate my plan"}
        </button>
      </form>
    </main>
  );
}

function AllocationPreview({
  alloc,
}: {
  alloc: { stocks: number; bonds: number; cash: number; alternatives: number };
}) {
  const segs = [
    { key: "Stocks", v: alloc.stocks, c: "var(--accent-dim)" },
    { key: "Bonds", v: alloc.bonds, c: "var(--chart-bonds)" },
    { key: "Cash", v: alloc.cash, c: "var(--chart-cash)" },
    { key: "Alts", v: alloc.alternatives, c: "var(--warn)" },
  ];
  return (
    <div className="rounded-xl p-4" style={{ background: "var(--panel-2)" }}>
      <p className="label">Your target mix</p>
      <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full">
        {segs.map((s) => (
          <div
            key={s.key}
            style={{ width: `${s.v}%`, background: s.c, transition: "width 200ms ease" }}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {segs.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: s.c }}
            />
            <span style={{ color: "var(--muted)" }}>{s.key}</span>
            <span className="font-semibold tabular-nums">{s.v}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
