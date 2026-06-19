// POST /api/insights
// Runs the insights synthesis pipeline for the supplied (or saved) profile.

import { NextResponse } from "next/server";
import { runInsightsPipeline } from "@/lib/insights";
import { PipelineError } from "@/lib/pipeline";
import { persistRun } from "@/lib/persistence";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let rawProfile: unknown = null;

  try {
    const body = await request.json();
    if (body && typeof body === "object" && "profile" in body) {
      rawProfile = (body as { profile: unknown }).profile;
    }
  } catch {
    // no body — fall through to the saved profile
  }

  if (!rawProfile && isSupabaseConfigured()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    if (!data) {
      return NextResponse.json(
        { error: "No saved profile. Complete onboarding first." },
        { status: 404 },
      );
    }
    rawProfile = {
      age: data.age,
      goal: data.goal,
      riskTolerance: data.risk_tolerance,
      horizonYears: data.horizon_years,
      journeyStage: data.journey_stage,
      monthlyContribution: data.monthly_contribution ?? undefined,
      interests: data.interests ?? [],
    };
  }

  if (!rawProfile) {
    return NextResponse.json({ error: "No profile provided." }, { status: 400 });
  }

  try {
    const digest = await runInsightsPipeline(rawProfile);
    await persistRun("insights", digest); // best-effort
    return NextResponse.json({ digest });
  } catch (err) {
    if (err instanceof PipelineError) {
      return NextResponse.json(
        { error: err.message, issues: err.issues },
        { status: 422 },
      );
    }
    console.error("Insights pipeline error:", err);
    return NextResponse.json(
      { error: "Failed to generate insights." },
      { status: 500 },
    );
  }
}
