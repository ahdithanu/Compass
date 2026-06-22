// POST /api/recommendations
// Runs the multi-stage recommendation pipeline for the supplied profile.
// The profile may come in the request body (used right after onboarding) or be
// loaded from the authenticated user's saved profile.

import { NextResponse } from "next/server";
import { runRecommendationPipeline, PipelineError } from "@/lib/pipeline";
import { persistRun } from "@/lib/persistence";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { rateLimit, clientKey, envLimit } from "@/lib/ratelimit";
import { readJsonCapped, BodyTooLargeError, bodyTooLargeResponse, rateLimitedResponse } from "@/lib/http";
import { withRequest } from "@/lib/api";

// Pipeline runs are the most expensive endpoint (LLM + market data), so keep the
// per-client budget modest. Overridable via env for load testing / tuning.
const WINDOW_MS = 60_000;
const limitFor = () => envLimit("API_RATE_LIMIT_RECS", 20);

export const POST = withRequest("recommendations", async (request) => {
  const rl = rateLimit(clientKey(request, "recs"), limitFor(), WINDOW_MS);
  if (!rl.ok) return rateLimitedResponse(rl);

  let rawProfile: unknown = null;

  // Prefer an explicitly posted profile.
  try {
    const body = await readJsonCapped(request);
    if (body && typeof body === "object" && "profile" in body) {
      rawProfile = (body as { profile: unknown }).profile;
    }
  } catch (err) {
    if (err instanceof BodyTooLargeError) return bodyTooLargeResponse();
    // malformed/empty body — fall through to the saved profile
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
    throw err; // -> withRequest logs it and returns a 500 with the request id
  }
});
