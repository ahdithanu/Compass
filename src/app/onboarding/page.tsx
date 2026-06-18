"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { Goal, JourneyStage, RiskTolerance } from "@/lib/types";

const GOALS: { value: Goal; label: string }[] = [
  { value: "retirement", label: "Retirement" },
  { value: "growth", label: "Long-term growth" },
  { value: "income", label: "Income" },
  { value: "preservation", label: "Preserve capital" },
  { value: "short_term", label: "A short-term goal" },
];
const RISKS: { value: RiskTolerance; label: string }[] = [
  { value: "conservative", label: "Conservative" },
  { value: "moderate", label: "Moderate" },
  { value: "aggressive", label: "Aggressive" },
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
        This shapes everything. You can change any of it later and your plan
        re-tunes instantly.
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

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="label">Risk tolerance</label>
            <select
              className="select mt-1"
              value={riskTolerance}
              onChange={(e) => setRisk(e.target.value as RiskTolerance)}
            >
              {RISKS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
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
