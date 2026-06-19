// End-to-end feed-precedence test. Drives the public insights pipeline
// (runInsightsPipeline) and asserts the full source-selection ladder that
// determines WHICH newsletter feeds actually get fetched:
//
//     per-user feeds  >  NEWSLETTER_FEEDS (env)  >  curated DEFAULT_FEEDS
//
// With no FMP_API_KEY (cleared in tests/setup.ts) getMarketNews returns sample
// data without touching the network, so every fetch() the pipeline makes comes
// from newsletter ingestion — which lets us read the precedence straight off the
// fetch call list. We also assert the winning feed's items reach the digest.

import { describe, it, expect, vi, afterEach } from "vitest";
import { runInsightsPipeline } from "@/lib/insights";
import { DEFAULT_FEEDS } from "@/lib/sources";

const profile = {
  age: 35,
  goal: "growth",
  riskTolerance: "moderate",
  horizonYears: 20,
  journeyStage: "building",
  interests: ["AI"],
};

// A dateless RSS item is kept regardless of the wall clock (the recency filter
// only drops *dated* items older than its window), so these assertions don't rot.
const rssFrom = (sourceLabel: string) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>${sourceLabel}</title>
<item><title>${sourceLabel} exclusive: $VTI rebalance note</title>
<link>https://${encodeURIComponent(sourceLabel)}.example/post1</link>
<description>A note tagged VTI from ${sourceLabel}.</description></item></channel></rss>`;

/** Stub fetch to serve RSS for any URL and return the list of URLs requested. */
function stubFetchRecording(): { urls: () => string[] } {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    text: async () => rssFrom(new URL(url).hostname),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return { urls: () => fetchMock.mock.calls.map((c) => c[0] as string) };
}

describe("feed precedence (end-to-end via runInsightsPipeline)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEWSLETTER_FEEDS; // setup.ts also clears it before each test
  });

  it("per-user feeds win over both the env override and the defaults", async () => {
    process.env.NEWSLETTER_FEEDS = "Env Letter|https://env.example/rss";
    const { urls } = stubFetchRecording();

    const digest = await runInsightsPipeline(profile, {
      feeds: [{ name: "My Feed", url: "https://userfeed.example/rss", category: "macro" }],
    });

    // Exactly the one user feed was fetched — env + defaults were ignored.
    expect(urls()).toEqual(["https://userfeed.example/rss"]);
    expect(urls()).not.toContain("https://env.example/rss");
    for (const d of DEFAULT_FEEDS) expect(urls()).not.toContain(d.url);

    // ...and the user feed's item (sourced under its name) threaded all the way
    // into the digest sources.
    expect(digest.sources.some((s) => s.source === "My Feed")).toBe(true);
    expect(digest.meta.dataSource).toBe("live");
  });

  it("falls back to the env override when no per-user feeds are supplied", async () => {
    process.env.NEWSLETTER_FEEDS =
      "Env Letter|https://env.example/rss, https://env2.example/feed.xml";
    const { urls } = stubFetchRecording();

    await runInsightsPipeline(profile); // no opts.feeds

    expect(urls().sort()).toEqual(
      ["https://env.example/rss", "https://env2.example/feed.xml"].sort(),
    );
    for (const d of DEFAULT_FEEDS) expect(urls()).not.toContain(d.url);
  });

  it("treats an empty per-user feed list as 'use the fallback', not 'fetch nothing'", async () => {
    process.env.NEWSLETTER_FEEDS = "Env Letter|https://env.example/rss";
    const { urls } = stubFetchRecording();

    await runInsightsPipeline(profile, { feeds: [] });

    // Empty override is ignored; the env list is used.
    expect(urls()).toEqual(["https://env.example/rss"]);
  });

  it("falls back to the curated defaults when there are no user feeds and no env", async () => {
    const { urls } = stubFetchRecording();

    await runInsightsPipeline(profile); // no feeds, no NEWSLETTER_FEEDS

    expect(urls().sort()).toEqual(DEFAULT_FEEDS.map((f) => f.url).sort());
  });
});
