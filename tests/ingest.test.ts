import { describe, it, expect, vi, afterEach } from "vitest";
import { parseFeed, ingestNewsletters } from "@/lib/ingest";

const feed = { name: "Test Feed", url: "https://ex.com/rss" };

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>
<item><title><![CDATA[Markets slip as $AAPL leads tech lower]]></title>
<link>https://ex.com/a</link><description><![CDATA[<p>Stocks fell. VTI down.</p>]]></description>
<pubDate>Wed, 17 Jun 2026 13:30:00 GMT</pubDate></item>
<item><title>Bonds catch a bid</title><link>https://ex.com/b</link>
<description>BND rose modestly.</description><pubDate>Tue, 16 Jun 2026 20:45:00 GMT</pubDate></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>A</title>
<entry><title>AI capex stays strong for SMH</title>
<link rel="alternate" href="https://ex.com/atom1"/>
<summary>Demand resilient.</summary><updated>2026-06-15T12:00:00Z</updated></entry></feed>`;

describe("parseFeed", () => {
  it("parses RSS 2.0, strips HTML, and normalizes dates", () => {
    const items = parseFeed(RSS, feed, new Set(["VTI", "BND"]));
    expect(items.length).toBe(2);
    expect(items[0].title).toBe("Markets slip as $AAPL leads tech lower");
    expect(items[0].summary).not.toMatch(/</); // HTML stripped
    expect(items[0].summary).toContain("Stocks fell");
    expect(items[0].url).toBe("https://ex.com/a");
    expect(items[0].kind).toBe("newsletter");
    expect(items[0].publishedAt).toMatch(/^2026-06-17T/); // ISO
  });

  it("tags cashtags and watchlist tickers", () => {
    const items = parseFeed(RSS, feed, new Set(["VTI", "BND"]));
    expect(items[0].tickers).toContain("AAPL"); // $AAPL cashtag
    expect(items[0].tickers).toContain("VTI"); // watchlist match in body
    expect(items[1].tickers).toContain("BND");
  });

  it("parses Atom entries and extracts the alternate link", () => {
    const items = parseFeed(ATOM, feed, new Set(["SMH"]));
    expect(items.length).toBe(1);
    expect(items[0].url).toBe("https://ex.com/atom1");
    expect(items[0].tickers).toContain("SMH");
  });

  it("returns an empty array for garbage XML", () => {
    expect(parseFeed("not xml at all", feed, new Set())).toEqual([]);
  });
});

describe("ingestNewsletters", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("falls back to sample items when every feed fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("blocked")));
    const res = await ingestNewsletters(["VTI"]);
    expect(res.source).toBe("fallback");
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items.every((i) => i.kind === "newsletter")).toBe(true);
    expect(res.feedsOk).toBe(0);
  });

  it("ingests and re-ids items when feeds return content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => RSS }),
    );
    const res = await ingestNewsletters(["VTI", "BND"]);
    expect(res.source).toBe("live");
    expect(res.feedsOk).toBeGreaterThan(0);
    // ids are reassigned sequentially as nl0, nl1, ...
    expect(res.items[0].id).toMatch(/^nl\d+$/);
  });

  it("uses a per-user feed override when provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, text: async () => RSS });
    vi.stubGlobal("fetch", fetchMock);

    await ingestNewsletters(
      ["VTI"],
      [{ name: "My Feed", url: "https://only-this.example/rss" }],
    );

    // exactly the one override feed was fetched (defaults were not used)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://only-this.example/rss");
  });
});
