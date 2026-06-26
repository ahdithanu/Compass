// GET /api/history          -> the signed-in user's recent runs (summaries)
// GET /api/history?id=<id>  -> the full stored payload of one past run
//
// Returns an empty list / 404 for anonymous/demo users so the dashboard can
// render gracefully. Ownership is enforced by RLS and re-asserted with an
// explicit user_id filter (defense in depth).

import { NextResponse } from "next/server";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { withRequest } from "@/lib/api";

export const GET = withRequest("history", async (request) => {
  if (!isSupabaseConfigured()) return NextResponse.json({ runs: [] });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ runs: [] });

  const id = new URL(request.url).searchParams.get("id");

  // Detail: one run's full payload so the user can re-open a past plan.
  if (id) {
    const { data, error } = await supabase
      .from("runs")
      .select("id, kind, reasoning_source, data_source, created_at, payload")
      .eq("user_id", user.id)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: "Failed to load run." }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }
    return NextResponse.json({ run: data });
  }

  // List: recent run summaries, newest first.
  const { data, error } = await supabase
    .from("runs")
    .select(
      "id, kind, trace_id, reasoning_source, data_source, checks_passed, checks_total, created_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: "Failed to load history." }, { status: 500 });
  }
  return NextResponse.json({ runs: data ?? [] });
});
