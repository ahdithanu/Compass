# Compass — personalized investing co-pilot

A dashboard that, based on a user's goals, age, risk appetite, and where they
are in their journey, tells them **what to track, what markets to watch, which
names to focus on, and what the move is** — each with a clear, sourced *why*.
It re-tunes whenever the user updates their profile.

> **Educational information only — not personalized financial advice.**

## What's built (first slice)

- **Onboarding → personalized picks with reasoning.** Login → profile (age,
  goal, risk, horizon, journey stage, interests) → a recommendation with asset
  allocation, sectors to watch, specific tickers, and "the move."
- **Multi-stage recommendation pipeline with checker gates** (the core of the
  reliability story — see below).
- **Insights digest** — market news **+ ingested newsletters/RSS** synthesized
  into a personalized "what's moving for you" feed with per-source citations.
  Ingestion (`ingest.ts`) fetches configurable RSS/Atom feeds concurrently
  (per-feed timeout + retry, skip-on-fail), normalizes + ticker-tags them, and
  merges them with the market feed as first-class, citable sources. Configure
  via `NEWSLETTER_FEEDS`; falls back to sample items with zero network.
- **Persisted run history + checker audit log** (Supabase `runs` / `run_checks`
  tables, RLS-scoped), surfaced in the dashboard.
- **Resilience & observability** baked in: timeouts + bounded retries on every
  external call, graceful degradation, and a trace ID + structured logs for
  every run.

## Architecture

A **code-orchestrated pipeline** (`src/lib/pipeline.ts`) runs each
recommendation through specialized stages, with a checker gate after each:

| Stage | Role | Checker gate |
|---|---|---|
| 1 | Profile validator (`validate.ts`) | range/enum/contradiction checks |
| 2 | Allocator (`allocate.ts`) | allocation sums to 100%, no negative weights |
| 3 | Market data (`fmp.ts`) | timeout + retry; falls back to sample quotes |
| 4 | Analyst / synthesizer (`claude.ts`) | strict JSON-schema output |
| 5 | **Critic / verifier** (`claude.ts`) | independent, adversarial: no hallucinated tickers, numbers trace to real data, suitability matches risk, disclaimers present |

On a failed check the critic feeds issues back for **one revision attempt**,
then falls back to a deterministic rule-based rationale — so the user always
gets a valid, safe result. Every check (pass and fail) is recorded in
`recommendation.meta.checks` and surfaced in the dashboard's "Verification &
sources" panel.

The LLM (`claude-opus-4-8`) only ever writes the *reasoning* around
deterministically-chosen tickers; it never invents instruments, which is what
makes the critic gate enforceable.

### Modern-architecture notes

Adopted now: API-first boundary, layered/modular monolith, staged pipeline with
gates, resilience (timeouts/retries/graceful degradation), observability (trace
IDs + structured logs). Deliberately deferred until scale: microservices,
micro-frontends, a dedicated API gateway, and rate limiting.

## Stack

Next.js (App Router, TypeScript) · Tailwind v4 · Supabase (auth + profile
storage) · Financial Modeling Prep (market data) · Anthropic (reasoning).

## Setup

```bash
npm install
cp .env.example .env.local   # fill in keys (all optional for a local demo)
npm run dev
```

The app runs with **zero keys** — it falls back to sample market data and a
rule-based rationale. Add keys to light up the full experience:

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — auth + saved
  profiles. Run `supabase/schema.sql` in the Supabase SQL editor first.
- `FMP_API_KEY` — live quotes.
- `ANTHROPIC_API_KEY` — Claude-written reasoning + the adversarial critic.

## Scripts

```bash
npm run dev        # local dev
npm run build      # production build
npm run typecheck  # tsc --noEmit
```

## Roadmap (next slices)

- Newsletter / industry-insight ingestion + synthesis on top of the live feed.
- Persisted recommendation history + an audit-log table for every checker run.
- Rebalancing nudges and change-driven re-tuning notifications.
