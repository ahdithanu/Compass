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
| 3 | Market data (`quotes.ts`, Finnhub) | timeout + retry; falls back to sample quotes |
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
IDs + structured logs), and basic abuse hardening on the write/compute routes
(per-client rate limiting + request body-size caps — see below). Deliberately
deferred until scale: microservices, micro-frontends, a dedicated API gateway,
and a shared/distributed rate-limit store.

### API hardening

The POST routes (`/api/recommendations`, `/api/insights`, `/api/feeds`) are
guarded by:

- **Per-client rate limiting** (`lib/ratelimit.ts`) — a fixed-window limiter
  keyed by `x-forwarded-for`/`x-real-ip` and scoped per route. Over-limit
  callers get `429` with a `Retry-After` header. Defaults: 20/min for the
  pipeline routes, 30/min for feed writes; overridable via
  `API_RATE_LIMIT_RECS` / `API_RATE_LIMIT_INSIGHTS` / `API_RATE_LIMIT_FEEDS`.
  State is per-process (acceptable as a first defense; a shared store is the
  scale-up path).
- **Body-size caps** (`lib/http.ts`) — bodies over 16 KB are rejected with `413`
  before parsing (checked via `Content-Length` and actual byte length), and feed
  URLs are capped at 2 KB in `validateFeed`.
- **Request-id correlation** (`lib/api.ts`) — every API route is wrapped by
  `withRequest`, which stamps each response with an `x-request-id` (reusing a
  sane client-supplied one for end-to-end correlation), emits a structured
  request/response log line, and converts any uncaught handler error into a
  clean `500` that echoes the id in the body for support/debugging.

### Typed database access

`src/lib/supabase/database.types.ts` is generated from the live schema, and both
the server and browser Supabase clients are instantiated as
`createClient<Database>(...)`. Every `.from(...).select/insert` is therefore
checked against the real columns — a renamed/dropped column breaks compilation at
the exact call site. Regenerate after any schema change with `npm run db:types`.

### Typography

Anthropic-style font pairing loaded via `next/font/google` in `app/layout.tsx`:
**Fraunces** (warm display serif) for headings and **Inter** (grotesque) for body,
exposed as `--font-serif` / `--font-sans` and applied in `globals.css`. `next/font`
self-hosts the files at build time, so there's no runtime dependency on Google.

### Client-side API access

The pages call the API through `lib/apiClient.ts` (`apiGet`/`apiPost`/`apiDelete`)
rather than raw `fetch`. It returns a discriminated `ApiResult<T>` —
`{ ok: true, data, requestId }` or `{ ok: false, error, issues?, status, requestId }` —
with friendly per-status fallback messages and network-failure handling. On error
the UI shows the message plus the `x-request-id` (via `withRef`) so a user can
quote it for support.

## Stack

Next.js (App Router, TypeScript) · Tailwind v4 · Supabase (auth + profile
storage) · Finnhub (market quotes) · Anthropic (reasoning).

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
- `FINNHUB_API_KEY` **or** `ALPHAVANTAGE_API_KEY` — live market quotes (free
  tiers cover US stocks/ETFs; Finnhub ~60/min, Alpha Vantage ~25/day).
- `ANTHROPIC_API_KEY` — Claude-written reasoning + the adversarial critic.
- `FMP_API_KEY` — *(optional)* market news; the RSS/newsletter feeds already
  provide live news without a key.

## Scripts

```bash
npm run dev        # local dev
npm run build      # production build
npm run typecheck  # tsc --noEmit
npm test           # run the hermetic Vitest suite
npm run test:watch # watch mode
npm run test:integration  # live Supabase smoke test (needs env, see Testing)
```

## Testing

A Vitest suite (`tests/`) covers the pure logic, the pipeline orchestration, and
the API route handlers — 109 tests, all hermetic (no network, no API keys;
external calls and Supabase are mocked, so external paths hit the deterministic
fallbacks):

- **Validators & checker gates** — profile validation, contradictions,
  allocation/synthesis/insight groundedness checks.
- **Allocator regression guard** — sweeps all ~3,800 profile combinations and
  asserts the allocation always sums to 100 with no negative weights (the
  invariant that caught the original bug).
- **RSS/Atom parser** — CDATA, HTML stripping, ticker tagging, Atom link
  extraction, garbage input, and the network-failure fallback.
- **Pipeline orchestration** — the offline rule-based path, invalid/contradictory
  profiles, and the multi-agent branches with the LLM mocked: Claude success,
  revise-once-after-a-bad-draft, and double-critic-failure → safe fallback.
- **Feed-source precedence (end-to-end)** — drives `runInsightsPipeline` and
  asserts the full ladder for which newsletters get fetched: per-user feeds >
  `NEWSLETTER_FEEDS` (env) > curated defaults, including that an empty user list
  falls through to the env/defaults and that the winning feed's items reach the
  digest.
- **API route handlers** — auth gating, request validation, status-code/error
  mapping (`PipelineError` → 422, unique-violation → 409) and DB-result handling
  for `/api/feeds`, `/api/recommendations`, `/api/insights` and `/api/history`,
  with Supabase, the pipelines and persistence mocked.
- **Abuse hardening** — the fixed-window rate limiter (allow-up-to-limit, block,
  window reset, per-client isolation, `Retry-After`), the body-size cap
  (`413` via `Content-Length` and byte length), and the route-level `429`/`413`
  responses.
- **Request-id correlation** — every response carries an `x-request-id`, a sane
  client-supplied id is honored (junk is ignored), and an uncaught handler error
  becomes a `500` echoing the id.
- **Typed API client** (`lib/apiClient.ts`) — success/data/requestId parsing,
  per-status fallback messages, network-failure handling, JSON-body edge cases,
  and the `withRef` support-id formatter.

### Live integration smoke test

`tests/integration/feeds.integration.test.ts` exercises the **real** `user_feeds`
table — columns, RLS policies, and the `(user_id, url)` unique constraint — via a
full insert → list → duplicate → delete → verify-gone round trip. It's excluded
from the hermetic suite/CI and self-skips unless its env vars are set:

```bash
NEXT_PUBLIC_SUPABASE_URL=...      \
NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
SMOKE_TEST_EMAIL=you@example.com  \
SMOKE_TEST_PASSWORD=...           \
npm run test:integration
```

(Requires `supabase/schema.sql` applied and a confirmed test user in the project.)

CI (`.github/workflows/ci.yml`) runs typecheck + the hermetic tests + build on
every push/PR.

## Roadmap (next slices)

- Newsletter / industry-insight ingestion + synthesis on top of the live feed.
- Persisted recommendation history + an audit-log table for every checker run.
- Rebalancing nudges and change-driven re-tuning notifications.
