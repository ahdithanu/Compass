import { describe, it, expect } from "vitest";
import { getQuotes } from "@/lib/quotes";
import { getMarketNews } from "@/lib/news";

// With no API keys (cleared in setup), both clients use deterministic
// sample data without touching the network.

describe("getQuotes fallback", () => {
  it("returns sample quotes for known symbols and skips unknown ones", async () => {
    const { quotes, source } = await getQuotes(["VTI", "BND", "ZZZZ"]);
    expect(source).toBe("fallback");
    const symbols = quotes.map((q) => q.symbol);
    expect(symbols).toContain("VTI");
    expect(symbols).toContain("BND");
    expect(symbols).not.toContain("ZZZZ");
    expect(quotes.every((q) => Number.isFinite(q.price))).toBe(true);
  });

  it("handles an empty symbol list", async () => {
    const { quotes } = await getQuotes([]);
    expect(quotes).toEqual([]);
  });
});

describe("getMarketNews fallback", () => {
  it("returns sample news relevant to the watchlist", async () => {
    const { items, source } = await getMarketNews(["VTI", "QQQM"]);
    expect(source).toBe("fallback");
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => typeof i.id === "string")).toBe(true);
  });
});
