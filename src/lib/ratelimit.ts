// Rate limiter (fixed window) to blunt abusive bursts against the expensive
// POST routes (pipeline runs, DB writes).
//
// Two backends behind one async entrypoint, `checkRateLimit`:
//   • Distributed (Upstash Redis REST) when UPSTASH_REDIS_REST_URL/TOKEN are
//     set — a single shared window across every serverless instance, which is
//     what actually holds at scale (many concurrent instances, cold starts).
//   • In-memory fallback otherwise (and if the shared store errors) — per
//     process, but a safe local degrade rather than failing open to unlimited.
//
// The synchronous `rateLimit` below is the in-memory core; it stays pure and
// `now`-injectable for deterministic tests.

import { fetchWithTimeout } from "./resilience";

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window resets (0 when ok). */
  retryAfterSec: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

// Bound memory: if the map grows past this, drop entries whose window has
// already elapsed. Cheap and runs only when the map is large.
const MAX_TRACKED_KEYS = 10_000;

function prune(now: number): void {
  for (const [key, bucket] of store) {
    if (now >= bucket.resetAt) store.delete(key);
  }
}

/**
 * Count one hit against `key`. Returns whether it's allowed plus headroom info.
 * `now` is injectable for deterministic tests.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  if (store.size > MAX_TRACKED_KEYS) prune(now);

  let bucket = store.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    store.set(key, bucket);
  }

  bucket.count += 1;
  const ok = bucket.count <= limit;
  return {
    ok,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSec: ok ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/**
 * Derive a client identity for rate limiting. Prefer the platform-set client IP
 * (`x-vercel-forwarded-for` / `x-real-ip`), which the proxy overwrites and the
 * client cannot forge. Only fall back to the raw, client-controllable
 * `x-forwarded-for` as a last resort — a caller can rotate that header to dodge
 * the limiter, so it must not be the primary key on a trusted deployment.
 * `scope` separates limits per route so one endpoint can't exhaust another's.
 */
/** True when a shared rate-limit store (Upstash Redis REST) is configured. */
export function isDistributedRateLimit(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

const UPSTASH_TIMEOUT_MS = 600;

/**
 * Count one hit against `key`, using the shared store when configured so the
 * window holds across every instance. Falls back to the in-memory limiter if no
 * store is configured or the store errors — a local degrade, never fail-open.
 * This is what routes should call.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  if (isDistributedRateLimit()) {
    try {
      return await upstashRateLimit(key, limit, windowMs);
    } catch (err) {
      console.warn("[ratelimit] shared store error; using in-memory fallback:", err);
    }
  }
  return rateLimit(key, limit, windowMs);
}

/**
 * Atomic fixed-window counter in Redis via the Upstash REST pipeline:
 *   INCR key                 -> the running count in this window
 *   PEXPIRE key windowMs NX  -> set the window TTL only on the first hit
 *   PTTL key                 -> ms left, for an accurate Retry-After
 */
async function upstashRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const base = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  const res = await fetchWithTimeout(`${base}/pipeline`, UPSTASH_TIMEOUT_MS, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", key],
      ["PEXPIRE", key, windowMs, "NX"],
      ["PTTL", key],
    ]),
  });
  if (!res.ok) throw new Error(`upstash HTTP ${res.status}`);
  const parts = (await res.json()) as { result?: number; error?: string }[];
  const count = Number(parts?.[0]?.result);
  const pttl = Number(parts?.[2]?.result);
  if (!Number.isFinite(count)) throw new Error("upstash: malformed pipeline result");

  const ok = count <= limit;
  const leftMs = Number.isFinite(pttl) && pttl > 0 ? pttl : windowMs;
  return {
    ok,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterSec: ok ? 0 : Math.max(1, Math.ceil(leftMs / 1000)),
  };
}

export function clientKey(request: Request, scope: string): string {
  const ip =
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    (request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "") ||
    "local";
  return `${scope}:${ip}`;
}

/** Read a positive integer limit from an env var, falling back to `fallback`
 *  when unset/malformed (a NaN limit would otherwise block every request). */
export function envLimit(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// A global cap only holds across instances when a shared store is configured;
// with the in-memory fallback each serverless instance keeps its own counter, so
// the effective ceiling is (instances × limit). Warn once so this isn't silent.
let warnedNoSharedStore = false;
function warnIfLocalGlobalCap(name: string): void {
  if (!warnedNoSharedStore && !isDistributedRateLimit()) {
    warnedNoSharedStore = true;
    console.warn(
      `[ratelimit] ${name} is enforced per-instance (no UPSTASH_REDIS_REST_URL). ` +
        `The global cap only bounds aggregate throughput with a shared store configured.`,
    );
  }
}

/**
 * Global LLM throughput cap — a hard backstop on paid Claude calls across ALL
 * users combined. Per-IP limits bound one caller; this bounds aggregate spend
 * (many signed-in users, or one attacker rotating IPs). Consumes one slot from a
 * single shared window keyed on a constant; when the window is exhausted, callers
 * degrade to the rule-based path instead of making a paid call — spend is capped
 * without breaking the UX. Sized by LLM_MAX_CALLS_PER_MIN (default 60). Uses the
 * shared Upstash store when configured so the cap holds across instances.
 */
export async function llmBudgetAvailable(): Promise<boolean> {
  warnIfLocalGlobalCap("LLM throughput cap");
  const perMin = envLimit("LLM_MAX_CALLS_PER_MIN", 60);
  const r = await checkRateLimit("global:llm", perMin, 60_000);
  return r.ok;
}

/**
 * Global market-data throughput cap — the same backstop for the metered market
 * providers (Finnhub / FMP / Alpha Vantage), which the LLM cap does NOT cover.
 * Every recommendation/insights/backtest request fetches quotes/news before any
 * LLM stage, so without this an anonymous IP-rotating caller can burn those
 * quotas freely. When exhausted, callers fall back to sample/simulated data —
 * capped without erroring. Sized by MARKET_DATA_MAX_CALLS_PER_MIN (default 120).
 */
export async function marketDataBudgetAvailable(): Promise<boolean> {
  warnIfLocalGlobalCap("market-data throughput cap");
  const perMin = envLimit("MARKET_DATA_MAX_CALLS_PER_MIN", 120);
  const r = await checkRateLimit("global:marketdata", perMin, 60_000);
  return r.ok;
}

/** Test-only: clear all buckets so cases don't bleed into each other. */
export function __resetRateLimit(): void {
  store.clear();
}
