// Best-effort persistence of pipeline runs + their checker audit trail. Writes
// one `runs` row (full payload + summary) and one `run_checks` row per gate.
// Never throws — persistence failures must not break a recommendation.

import type { InsightDigest, Recommendation } from "./types";
import { createClient, isSupabaseConfigured } from "./supabase/server";

type RunKind = "recommendation" | "insights";

export async function persistRun(
  kind: RunKind,
  payload: Recommendation | InsightDigest,
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return; // anonymous/demo runs aren't persisted

    const { meta } = payload;
    const passed = meta.checks.filter((c) => c.passed).length;

    const { data: run, error } = await supabase
      .from("runs")
      .insert({
        user_id: user.id,
        kind,
        trace_id: meta.traceId,
        reasoning_source: meta.reasoningSource,
        data_source: meta.dataSource,
        checks_passed: passed,
        checks_total: meta.checks.length,
        payload,
      })
      .select("id")
      .single();

    if (error || !run) return;

    if (meta.checks.length > 0) {
      await supabase.from("run_checks").insert(
        meta.checks.map((c) => ({
          run_id: run.id,
          user_id: user.id,
          stage: c.stage,
          name: c.name,
          passed: c.passed,
          detail: c.detail ?? null,
        })),
      );
    }
  } catch (err) {
    console.warn("[persistence] failed to persist run:", err);
  }
}
