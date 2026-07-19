import { describe, it, expect, beforeEach, vi } from "vitest";
import { sigOf, cacheKey, readCache, writeCache, clearAllPlanCache } from "@/lib/runCache";

function mockStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

describe("runCache", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("sessionStorage", mockStorage());
  });

  it("sigOf is stable and distinguishes payloads", () => {
    expect(sigOf({ profile: { age: 30 } })).toBe(sigOf({ profile: { age: 30 } }));
    expect(sigOf({ profile: { age: 30 } })).not.toBe(sigOf({ profile: { age: 31 } }));
    expect(sigOf({})).toBe(sigOf({}));
  });

  it("round-trips within TTL and namespaces by kind", () => {
    const recK = cacheKey("rec", { profile: { age: 30 } });
    const insK = cacheKey("ins", { profile: { age: 30 } });
    expect(recK).not.toBe(insK); // same payload, different kind
    writeCache(recK, { recommendation: { x: 1 } });
    expect(readCache(recK)).toEqual({ recommendation: { x: 1 } });
    expect(readCache(insK)).toBeNull();
  });

  it("clearAllPlanCache drops only compass:cache keys", () => {
    sessionStorage.setItem("compass:profile", "keep");
    writeCache(cacheKey("rec", {}), { a: 1 });
    writeCache(cacheKey("ins", {}), { b: 2 });
    clearAllPlanCache();
    expect(readCache(cacheKey("rec", {}))).toBeNull();
    expect(readCache(cacheKey("ins", {}))).toBeNull();
    expect(sessionStorage.getItem("compass:profile")).toBe("keep");
  });
});
