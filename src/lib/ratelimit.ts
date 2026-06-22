// Lightweight in-memory rate limiter (fixed window). Good enough to blunt
// abusive bursts against the expensive POST routes (pipeline runs, DB writes).
//
// Caveat: state is per-process, so on a multi-instance/serverless deployment the
// effective limit is per instance, and buckets reset on cold start. That's an
// acceptable first line of defense; a shared store (Upstash/Redis) is the
// upgrade path if/when we run multiple persistent instances.

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
export function clientKey(request: Request, scope: string): string {
  const ip =
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    (request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "") ||
    "local";
  return `${scope}:${ip}`;
}

/** Test-only: clear all buckets so cases don't bleed into each other. */
export function __resetRateLimit(): void {
  store.clear();
}
