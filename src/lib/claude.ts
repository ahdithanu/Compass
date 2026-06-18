// The reasoning layer. Two distinct roles, each its own Claude call with a
// strict output schema:
//   - synthesize(): writes the "why" around the deterministic picks.
//   - critique():   an INDEPENDENT adversarial pass that audits the synthesis
//                   for groundedness, suitability, tone, and disclaimers.
// Both return null when ANTHROPIC_API_KEY is absent so the pipeline can fall
// back to a rule-based rationale without crashing.

import Anthropic from "@anthropic-ai/sdk";
import type {
  Allocation,
  CandidatePick,
  CritiqueResult,
  Profile,
  Quote,
  SectorWatch,
  SynthesisDraft,
} from "./types";

const MODEL = "claude-opus-4-8";

function client(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  // SDK-native resilience: bounded retries on 429/5xx + a per-request timeout.
  return apiKey
    ? new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 })
    : null;
}

function firstJson<T>(message: Anthropic.Message): T | null {
  const text = message.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return null;
  try {
    return JSON.parse(text.text) as T;
  } catch {
    return null;
  }
}

const SYNTHESIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    theMove: {
      type: "object",
      additionalProperties: false,
      properties: {
        headline: { type: "string" },
        reasoning: { type: "string" },
      },
      required: ["headline", "reasoning"],
    },
    sectorsToWatch: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sector: { type: "string" },
          why: { type: "string" },
        },
        required: ["sector", "why"],
      },
    },
    pickRationales: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ticker: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["ticker", "rationale"],
      },
    },
  },
  required: ["summary", "theMove", "sectorsToWatch", "pickRationales"],
} as const;

const CRITIQUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    passed: { type: "boolean" },
    issues: { type: "array", items: { type: "string" } },
  },
  required: ["passed", "issues"],
} as const;

interface SynthesisContext {
  profile: Profile;
  allocation: Allocation;
  candidates: CandidatePick[];
  quotes: Quote[];
  sectors: SectorWatch[];
  dataSource: "live" | "fallback";
}

const SYNTHESIS_SYSTEM = `You are the analyst in a personalized investing co-pilot. You write the educational "why" around a portfolio that has ALREADY been decided by a deterministic engine.

Hard rules:
- You may ONLY reference tickers from the provided candidate list. Never introduce a ticker that is not in that list.
- Only cite prices or percentages that appear in the provided market data. Never invent a number. If a figure isn't provided, speak qualitatively.
- This is educational information, not personalized financial advice. Never use imperative "you must buy" language; frame as "this allocation is designed to…".
- Tie every rationale to the user's stated profile (age, goal, risk, horizon, journey stage).
- Be concrete and concise. No hype, no guarantees about returns.
Return JSON only, matching the schema.`;

const CRITIQUE_SYSTEM = `You are an independent compliance + quality reviewer auditing an investing co-pilot's draft output. You did NOT write it. Be adversarial and specific.

Fail the draft (passed=false) if ANY of these hold, listing each as an issue:
- It cites a ticker not present in the candidate list.
- It states a price or percentage that does not match the provided market data, or invents figures.
- The recommendation is unsuitable for the user's risk tolerance or horizon (e.g. aggressive bets for a conservative, short-horizon profile).
- It uses prescriptive "advice" language or guarantees/implies returns.
- A pick is missing a rationale, or the summary/"the move" is empty.
Otherwise pass it. Return JSON only, matching the schema.`;

function contextBlock(ctx: SynthesisContext): string {
  const quoteLines = ctx.quotes
    .map((q) => `  ${q.symbol}: $${q.price} (${q.changePercent.toFixed(2)}%)`)
    .join("\n");
  return [
    `User profile: ${JSON.stringify(ctx.profile)}`,
    `Target allocation (%): ${JSON.stringify(ctx.allocation)}`,
    `Candidate instruments (the ONLY tickers you may reference):`,
    ...ctx.candidates.map((c) => `  ${c.ticker} — ${c.name} [${c.bucket}]`),
    `Market data (source: ${ctx.dataSource}):`,
    quoteLines || "  (no live quotes available)",
    `Sectors to watch (refine the 'why', keep the sectors): ${JSON.stringify(ctx.sectors)}`,
  ].join("\n");
}

export async function synthesize(
  ctx: SynthesisContext,
  priorIssues?: string[],
): Promise<SynthesisDraft | null> {
  const anthropic = client();
  if (!anthropic) return null;

  const revisionNote = priorIssues?.length
    ? `\n\nYour previous draft was rejected by the reviewer for these reasons. Fix ALL of them:\n- ${priorIssues.join("\n- ")}`
    : "";

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    system: SYNTHESIS_SYSTEM,
    output_config: { format: { type: "json_schema", schema: SYNTHESIS_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Write the recommendation rationale for this user.\n\n${contextBlock(ctx)}${revisionNote}`,
      },
    ],
  });

  return firstJson<SynthesisDraft>(message);
}

export async function critique(
  draft: SynthesisDraft,
  ctx: SynthesisContext,
): Promise<CritiqueResult | null> {
  const anthropic = client();
  if (!anthropic) return null;

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    system: CRITIQUE_SYSTEM,
    output_config: { format: { type: "json_schema", schema: CRITIQUE_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Audit this draft against the source context.\n\nSOURCE CONTEXT:\n${contextBlock(ctx)}\n\nDRAFT TO AUDIT:\n${JSON.stringify(draft, null, 2)}`,
      },
    ],
  });

  return firstJson<CritiqueResult>(message);
}

export type { SynthesisContext };
