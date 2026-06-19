// POST /api/recommendations
// Runs the multi-stage recommendation pipeline for the supplied profile.
// The profile may come in the request body (used right after onboarding) or be
// loaded from the authenticated user's saved profile.

import { NextResponse } from "next/server";
import { runRecommendationPipeline, PipelineError } from "@/lib/pipeline";
import { persistRun } from "@/lib/persistence";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let rawProfile: unknown = null;

  // Prefer an explicitly posted profile.
  try {
    const body = await request.json();
    if (body && typeof body === "object" && "profile" in body) {
      rawProfile = (body as { profile: unknown }).profile;
    }
  } catch {
    // no body — fall through to the saved profile
  }

  // Otherwise load the signed-in user's saved profile.
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
    return NextResponse.json(
      { error: "No profile provided." },
      { status: 400 },
    );
  }

  try {
    const recommendation = await runRecommendationPipeline(rawProfile);
    await persistRun("recommendation", recommendation); // best-effort
    return NextResponse.json({ recommendation });
  } catch (err) {
    if (err instanceof PipelineError) {
      return NextResponse.json(
        { error: err.message, issues: err.issues },
        { status: 422 },
      );
    }
    console.error("Recommendation pipeline error:", err);
    return NextResponse.json(
      { error: "Failed to generate recommendation." },
      { status: 500 },
    );
  }
}
