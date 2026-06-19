import { describe, it, expect, vi, afterEach } from "vitest";
import { runInsightsPipeline } from "@/lib/insights";
import { PipelineError } from "@/lib/pipeline";

const profile = {
  age: 35,
  goal: "growth",
  riskTolerance: "moderate",
  horizonYears: 20,
  journeyStage: "building",
  interests: ["AI"],
};

describe("runInsightsPipeline (offline)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("produces a digest merging market + newsletter sources with checks", async () => {
    // Block outbound RSS fetches -> newsletter ingestion uses sample fallback.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("blocked")));

    const digest = await runInsightsPipeline(profile);

    expect(digest.headline.trim().length).toBeGreaterThan(0);
    expect(digest.insights.length).toBeGreaterThan(0);
    expect(digest.sources.length).toBeGreaterThan(0);

    // both source types are present and both source gates ran
    expect(digest.sources.some((s) => s.kind === "market")).toBe(true);
    expect(digest.sources.some((s) => s.kind === "newsletter")).toBe(true);
    const sourceChecks = digest.meta.checks.filter((c) => c.stage === "sources");
    expect(sourceChecks.map((c) => c.name)).toContain("market_sources_present");
    expect(sourceChecks.map((c) => c.name)).toContain("newsletters_ingested");

    // offline -> rule-based digest, but still a full audit trail
    expect(digest.meta.reasoningSource).toBe("rule_based");
    expect(digest.meta.traceId).toMatch(/^trc_/);

    // every rule-based insight cites a real source id
    const ids = new Set(digest.sources.map((s) => s.id));
    expect(
      digest.insights.every((ins) => ins.sourceIds.every((id) => ids.has(id))),
    ).toBe(true);
  });

  it("rejects an invalid profile", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("blocked")));
    await expect(
      runInsightsPipeline({ ...profile, age: 0 }),
    ).rejects.toBeInstanceOf(PipelineError);
  });
});
