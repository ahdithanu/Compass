// POST /api/recommendations
// Runs the multi-stage recommendation pipeline for the supplied profile.
// The profile may come in the request body (used right after onboarding) or be
// loaded from the authenticated user's saved profile.

import { NextResponse } from "next/server";
import { runRecommendationPipeline, PipelineError } from "@/lib/pipeline";
import { persistRun } from "@/lib/persistence";
import { DEFAULT_PROFILE } from "@/lib/profile";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { checkRateLimit, clientKey, envLimit } from "@/lib/ratelimit";
import { readJsonCapped, BodyTooLargeError, bodyTooLargeResponse, rateLimitedResponse } from "@/lib/http";
import { withRequest } from "@/lib/api";

// Pipeline runs are the most expensive endpoint (LLM + market data), so keep the
// per-client budget modest. Overridable via env for load testing / tuning.
const WINDOW_MS = 60_000;
const limitFor = () => envLimit("API_RATE_LIMIT_RECS", 20);

export const POST = withRequest("recommendations", async (request) => {
  const rl = await checkRateLimit(clientKey(request, "recs"), limitFor(), WINDOW_MS);
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

  // No posted profile: load the signed-in user's saved profile, or fall back to
  // a sample profile so the dashboard is explorable in demo mode (matching the
  // projection/rebalance pages). Only an authenticated user *without* a saved
  // profile is bounced to onboarding.
  let demo = false;
  if (!rawProfile) {
    if (isSupabaseConfigured()) {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
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
      } else {
        rawProfile = DEFAULT_PROFILE;
        demo = true;
      }
    } else {
      rawProfile = DEFAULT_PROFILE;
      demo = true;
    }
  }

  try {
    const recommendation = await runRecommendationPipeline(rawProfile);
    await persistRun("recommendation", recommendation); // best-effort; no-ops for anon
    return NextResponse.json({ recommendation, demo });
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
