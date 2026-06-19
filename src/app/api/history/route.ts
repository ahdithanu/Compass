// GET /api/history
// Returns the signed-in user's recent pipeline runs (newest first). Returns an
// empty list for anonymous/demo users so the dashboard can render gracefully.

import { NextResponse } from "next/server";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ runs: [] });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ runs: [] });

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
}
