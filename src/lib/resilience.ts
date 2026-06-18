// Resilience primitives for calls that leave the process (market data, LLM).
// Keeps a hung or flaky upstream from hanging a user request.

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/** fetch() with a hard timeout via AbortController. */
export async function fetchWithTimeout(
  url: string,
  ms: number,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run `fn`, retrying on throw with exponential backoff. Returns null after the
 * final failure so callers can degrade gracefully rather than propagate.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number; label?: string } = {},
): Promise<T | null> {
  const { retries = 1, baseMs = 250, label = "operation" } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(baseMs * 2 ** attempt);
      }
    }
  }
  console.warn(`[resilience] ${label} failed after ${retries + 1} attempts:`, lastErr);
  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
