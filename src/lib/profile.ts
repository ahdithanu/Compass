// A neutral sample profile used for demo mode — when there's no posted profile
// and no signed-in user, the recommendation/insights pipelines and the
// projection/rebalance pages fall back to this so the product is explorable
// without onboarding. A middle-of-the-road long-horizon growth investor.

import type { Profile } from "./types";

export const DEFAULT_PROFILE: Profile = {
  age: 35,
  goal: "growth",
  riskTolerance: "moderate",
  horizonYears: 20,
  journeyStage: "building",
  interests: [],
};
