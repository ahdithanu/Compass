import { describe, it, expect } from "vitest";
import {
  buildAllocation,
  selectCandidates,
  baseSectors,
} from "@/lib/allocate";
import { checkAllocation } from "@/lib/validate";
import type { Goal, JourneyStage, Profile, RiskTolerance } from "@/lib/types";

const GOALS: Goal[] = ["retirement", "growth", "income", "preservation", "short_term"];
const RISKS: RiskTolerance[] = ["conservative", "moderate", "aggressive"];
const STAGES: JourneyStage[] = ["just_starting", "building", "established", "nearing_goal"];
const AGES = [18, 25, 30, 45, 60, 75, 90];
const HORIZONS = [0, 1, 2, 3, 5, 7, 15, 30, 50];

function* allProfiles(): Generator<Profile> {
  for (const age of AGES)
    for (const goal of GOALS)
      for (const riskTolerance of RISKS)
        for (const journeyStage of STAGES)
          for (const horizonYears of HORIZONS)
            yield { age, goal, riskTolerance, horizonYears, journeyStage, interests: [] };
}

describe("buildAllocation (regression guard)", () => {
  it("always sums to 100 with no negative weights across the whole profile space", () => {
    let count = 0;
    for (const p of allProfiles()) {
      count++;
      const a = buildAllocation(p);
      const parts = [a.stocks, a.bonds, a.cash, a.alternatives];
      // This is the exact invariant that caught the original bug.
      expect(parts.every((v) => v >= 0), `negative weight for ${JSON.stringify(p)}`).toBe(
        true,
      );
      expect(a.stocks + a.bonds + a.cash + a.alternatives).toBe(100);
      expect(checkAllocation(a).passed, `checker failed for ${JSON.stringify(p)}`).toBe(
        true,
      );
    }
    expect(count).toBeGreaterThan(1000); // sanity: we actually swept the space
  });

  it("caps equity for short horizons", () => {
    const p: Profile = {
      age: 30,
      goal: "growth",
      riskTolerance: "aggressive",
      horizonYears: 2,
      journeyStage: "building",
      interests: [],
    };
    expect(buildAllocation(p).stocks).toBeLessThanOrEqual(40);
  });

  it("conservative tilts away from stocks vs aggressive at the same age", () => {
    const base = { age: 40, goal: "growth" as Goal, horizonYears: 20, journeyStage: "building" as JourneyStage, interests: [] };
    const cons = buildAllocation({ ...base, riskTolerance: "conservative" });
    const agg = buildAllocation({ ...base, riskTolerance: "aggressive" });
    expect(cons.stocks).toBeLessThan(agg.stocks);
  });
});

describe("selectCandidates", () => {
  const profile: Profile = {
    age: 30,
    goal: "growth",
    riskTolerance: "aggressive",
    horizonYears: 25,
    journeyStage: "building",
    interests: ["AI", "clean energy", "dividends", "cybersecurity"],
  };

  it("includes the broad-market core when equity is present", () => {
    const picks = selectCandidates(profile, buildAllocation(profile));
    expect(picks.some((p) => p.ticker === "VTI")).toBe(true);
  });

  it("maps interests to thematic picks, deduped and capped at 3", () => {
    const picks = selectCandidates(profile, buildAllocation(profile));
    const thematic = picks.filter((p) => p.bucket === "thematic");
    expect(thematic.length).toBeLessThanOrEqual(3);
    expect(thematic.length).toBeGreaterThan(0);
    // no duplicate tickers overall
    const tickers = picks.map((p) => p.ticker);
    expect(new Set(tickers).size).toBe(tickers.length);
  });

  it("includes a bond fund when the allocation holds bonds", () => {
    const conservative: Profile = {
      ...profile,
      riskTolerance: "conservative",
      goal: "income",
      interests: [],
    };
    const alloc = buildAllocation(conservative);
    const picks = selectCandidates(conservative, alloc);
    if (alloc.bonds > 0) expect(picks.some((p) => p.ticker === "BND")).toBe(true);
  });
});

describe("baseSectors", () => {
  it("returns at most 4 sectors", () => {
    const p: Profile = {
      age: 30,
      goal: "growth",
      riskTolerance: "aggressive",
      horizonYears: 20,
      journeyStage: "building",
      interests: [],
    };
    expect(baseSectors(p).length).toBeLessThanOrEqual(4);
    expect(baseSectors(p).length).toBeGreaterThan(0);
  });
});
