// POST /api/insights
// Runs the insights synthesis pipeline for the supplied (or saved) profile.

import { NextResponse } from "next/server";
import { runInsightsPipeline } from "@/lib/insights";
import { PipelineError } from "@/lib/pipeline";
import { persistRun } from "@/lib/persistence";
import { getUserFeeds } from "@/lib/feeds";
import type { FeedSource } from "@/lib/sources";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { rateLimit, clientKey, envLimit } from "@/lib/ratelimit";
import { readJsonCapped, BodyTooLargeError, bodyTooLargeResponse, rateLimitedResponse } from "@/lib/http";
import { withRequest } from "@/lib/api";

const WINDOW_MS = 60_000;
const limitFor = () => envLimit("API_RATE_LIMIT_INSIGHTS", 20);

export const POST = withRequest("insights", async (request) => {
  const rl = rateLimit(clientKey(request, "insights"), limitFor(), WINDOW_MS);
  if (!rl.ok) return rateLimitedResponse(rl);

  let rawProfile: unknown = null;
  let feeds: FeedSource[] | undefined;

  try {
    const body = await readJsonCapped(request);
    if (body && typeof body === "object" && "profile" in body) {
      rawProfile = (body as { profile: unknown }).profile;
    }
  } catch (err) {
    if (err instanceof BodyTooLargeError) return bodyTooLargeResponse();
    // malformed/empty body — fall through to the saved profile
  }

  // Load the signed-in user's profile (if not posted) and their custom feeds.
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!rawProfile) {
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

    if (user) {
      try {
        const userFeeds = await getUserFeeds(supabase, user.id);
        if (userFeeds.length > 0) feeds = userFeeds;
      } catch {
        // non-fatal — fall back to default feeds
      }
    }
  }

  if (!rawProfile) {
    return NextResponse.json({ error: "No profile provided." }, { status: 400 });
  }

  try {
    const digest = await runInsightsPipeline(rawProfile, { feeds });
    await persistRun("insights", digest); // best-effort
    return NextResponse.json({ digest });
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
