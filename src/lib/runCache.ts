// Session-scoped cache for the dashboard's generated plan. Without it, every
// navigation back to the dashboard re-runs the (paid) recommendation + insights
// pipelines and writes a new run row. Keyed by a signature of the request
// payload; short TTL; an explicit "Regenerate" bypasses it. Cleared on a
// sign-in/out identity change (see AuthSync) so plans never bleed across users.

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const PREFIX = "compass:cache:";

/** Stable short signature of a JSON-serializable payload (FNV-1a). */
export function sigOf(payload: unknown): string {
  const s = JSON.stringify(payload ?? {});
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function cacheKey(kind: "rec" | "ins", payload: unknown): string {
  return `${PREFIX}${kind}:${sigOf(payload)}`;
}

export function readCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; data?: T };
    if (typeof parsed.at !== "number" || Date.now() - parsed.at > TTL_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

export function writeCache(key: string, data: unknown): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* quota exceeded / storage disabled — caching is best-effort */
  }
}

/** Drop every cached plan (used on a sign-in/out identity change). */
export function clearAllPlanCache(): void {
  if (typeof window === "undefined") return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* storage unavailable — nothing to clear */
  }
}
