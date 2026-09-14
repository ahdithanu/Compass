// LLM-as-judge grader for the eval harness. An INDEPENDENT Claude pass that
// scores a recommendation against a rubric — the offline, batch complement to
// the runtime critic in claude.ts. Used only by the paid LLM-judge eval layer;
// returns null with no API key so callers can skip.
//
// The Anthropic call shape matches src/lib/claude.ts (verified against the
// current API): claude-opus-4-8, adaptive thinking, output_config.format.

import Anthropic from "@anthropic-ai/sdk";
import type { CandidatePick, Profile, Recommendation } from "@/lib/types";

const MODEL = "claude-opus-4-8";

export interface JudgeVerdict {
  groundedness: number; // 1-5
  suitability: number; // 1-5
  tone: number; // 1-5
  completeness: number; // 1-5
  overall: "pass" | "fail";
  issues: string[];
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    groundedness: { type: "integer" },
    suitability: { type: "integer" },
    tone: { type: "integer" },
    completeness: { type: "integer" },
    overall: { type: "string", enum: ["pass", "fail"] },
    issues: { type: "array", items: { type: "string" } },
  },
  required: ["groundedness", "suitability", "tone", "completeness", "overall", "issues"],
} as const;

const SYSTEM = `You are an independent evaluator grading an investing co-pilot's recommendation for a specific user profile. You did NOT write it. Be strict and specific.

Score each dimension 1-5 (5 = flawless):
- groundedness: rationales reference ONLY tickers in the provided candidate list; no invented tickers, prices, or figures.
- suitability: the allocation and picks fit the user's risk tolerance and horizon. Aggressive/high-equity mixes for a conservative or short-horizon user score low; overly timid mixes for a young aggressive investor also score low.
- tone: educational, not prescriptive ("this allocation is designed to…", never "you must buy"); no guarantees or implied returns; disclaimers present.
- completeness: every pick has a substantive rationale; the summary and "the move" are non-empty and specific.

Set overall = "fail" if groundedness < 4, or suitability < 4, or any dimension < 3. List every problem in "issues" (empty array if none). Return JSON only, matching the schema.`;

export async function judgeRecommendation(
  profile: Profile,
  rec: Recommendation,
  candidates: CandidatePick[],
): Promise<JudgeVerdict | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const anthropic = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });

  const context = {
    userProfile: profile,
    candidateTickers: candidates.map((c) => `${c.ticker} — ${c.name} [${c.bucket}]`),
    allocation: rec.allocation,
    picks: rec.picks.map((pk) => ({ ticker: pk.ticker, rationale: pk.rationale })),
    theMove: rec.theMove,
    summary: rec.summary,
    disclaimers: rec.disclaimers,
  };

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Grade this recommendation against the rubric.\n\n${JSON.stringify(context, null, 2)}`,
      },
    ],
  });

  const text = message.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return null;
  try {
    return JSON.parse(text.text) as JudgeVerdict;
  } catch {
    return null;
  }
}
