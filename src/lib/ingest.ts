// Newsletter / RSS ingestion. Fetches each configured feed concurrently with a
// per-feed timeout + retry (a slow or broken feed is skipped, never fatal),
// parses RSS 2.0 and Atom, normalizes to NewsItem, tags tickers, filters by
// recency, dedupes, and caps the total. Falls back to sample items when no feed
// yields anything, so the insights engine works with zero network access.

import { XMLParser } from "fast-xml-parser";
import type { NewsItem } from "./types";
import { fetchWithTimeout, withRetry } from "./resilience";
import { configuredFeeds, type FeedSource } from "./sources";
import { isBlockedHost } from "./feeds";

const FEED_TIMEOUT_MS = 5000;
const MAX_ITEMS_PER_FEED = 6;
const MAX_TOTAL_ITEMS = 10;
const RECENCY_DAYS = 14;
const MAX_REDIRECTS = 3;
const MAX_FEED_BYTES = 5_000_000; // cap parsed feed size (DoS guard)
const MAX_FEEDS_PER_RUN = 50; // cap outbound fan-out per ingestion run

export interface IngestResult {
  items: NewsItem[];
  source: "live" | "fallback";
  feedsOk: number;
  feedsTotal: number;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  processEntities: false, // RSS/Atom don't need custom entities; avoids expansion DoS
});

const SAMPLE_NEWSLETTERS: NewsItem[] = [
  {
    id: "nl-s1",
    title: "Weekly Brief: rotation out of high-multiple growth continues",
    source: "Sample Newsletter",
    publishedAt: "2026-06-17T09:00:00Z",
    tickers: ["QQQM", "VTI"],
    summary:
      "This week's letter argues the rotation from richly-valued growth into quality and value has further to run as financing costs stay elevated.",
    kind: "newsletter",
  },
  {
    id: "nl-s2",
    title: "Macro Notes: what softer data means for bonds and duration",
    source: "Sample Newsletter",
    publishedAt: "2026-06-16T08:30:00Z",
    tickers: ["BND"],
    summary:
      "A look at how cooling growth and inflation prints are reshaping the case for adding high-quality duration to balanced portfolios.",
    kind: "newsletter",
  },
  {
    id: "nl-s3",
    title: "Thematic Deep-Dive: the durable case for AI infrastructure",
    source: "Sample Newsletter",
    publishedAt: "2026-06-15T12:00:00Z",
    tickers: ["SMH", "BOTZ"],
    summary:
      "Why the analyst views AI-infrastructure demand as a multi-year capex cycle rather than a short-term spike, and what to watch.",
    kind: "newsletter",
  },
];

export async function ingestNewsletters(
  watchlist: string[],
  feedsOverride?: FeedSource[],
): Promise<IngestResult> {
  // Per-user feeds take precedence; otherwise fall back to the configured
  // (env / curated default) list. Cap the count so the outbound fan-out per run
  // is bounded regardless of how many feeds are configured.
  const feeds = (
    feedsOverride && feedsOverride.length > 0 ? feedsOverride : configuredFeeds()
  ).slice(0, MAX_FEEDS_PER_RUN);
  const watch = new Set(watchlist.map((t) => t.toUpperCase()));

  const settled = await Promise.allSettled(
    feeds.map((feed) => fetchAndParse(feed, watch)),
  );

  let feedsOk = 0;
  const all: NewsItem[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value.length > 0) {
      feedsOk++;
      all.push(...r.value);
    }
  }

  const cleaned = dedupe(all)
    .filter(recentEnough)
    .sort((a, b) => dateMs(b.publishedAt) - dateMs(a.publishedAt))
    .slice(0, MAX_TOTAL_ITEMS)
    .map((item, i) => ({ ...item, id: `nl${i}` }));

  if (cleaned.length === 0) {
    return {
      items: SAMPLE_NEWSLETTERS,
      source: "fallback",
      feedsOk: 0,
      feedsTotal: feeds.length,
    };
  }
  return { items: cleaned, source: "live", feedsOk, feedsTotal: feeds.length };
}

// Fetch a feed body, following redirects MANUALLY and re-validating the host on
// every hop. This is the SSRF guard that matters: validateFeed only checks the
// host at add-time, but a feed can 30x-redirect to 169.254.169.254/metadata —
// so we re-check each Location against the blocklist before following it.
async function fetchFeedXml(startUrl: string): Promise<string | null> {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      isBlockedHost(parsed.hostname)
    ) {
      return null; // refuse internal / metadata / non-http hosts on every hop
    }

    const res = await fetchWithTimeout(url, FEED_TIMEOUT_MS, {
      headers: { "user-agent": "CompassBot/1.0 (+rss)" },
      redirect: "manual",
    });

    const status = res.status ?? 200;
    if (status >= 300 && status < 400) {
      const loc = res.headers?.get?.("location");
      if (!loc) return null;
      url = new URL(loc, url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`${parsed.hostname} HTTP ${status}`);

    // Cheap pre-check, then a hard streamed cap so a huge/chunked body can't
    // be buffered into memory before we'd otherwise notice.
    const declared = res.headers?.get?.("content-length");
    if (declared && Number(declared) > MAX_FEED_BYTES) return null;
    return readBodyCapped(res, MAX_FEED_BYTES);
  }
  return null; // too many redirects
}

/** Read a response body, aborting once it exceeds `max` bytes. Falls back to a
 *  buffered read when the body isn't a stream (e.g. mocked responses in tests). */
async function readBodyCapped(res: Response, max: number): Promise<string | null> {
  const body = res.body as ReadableStream<Uint8Array> | null | undefined;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > max) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return new TextDecoder().decode(merged);
  }
  const text = await res.text();
  return Buffer.byteLength(text, "utf8") > max ? null : text;
}

async function fetchAndParse(
  feed: FeedSource,
  watch: Set<string>,
): Promise<NewsItem[]> {
  const xml = await withRetry(() => fetchFeedXml(feed.url), {
    retries: 1,
    label: `ingest:${feed.name}`,
  });
  if (!xml) return [];
  try {
    return parseFeed(xml, feed, watch);
  } catch {
    return [];
  }
}

/** Parse one feed's XML into NewsItems. Exported for direct unit testing. */
export function parseFeed(
  xml: string,
  feed: FeedSource,
  watch: Set<string>,
): NewsItem[] {
  const doc = parser.parse(xml);
  // RSS 2.0
  const rssItems = asArray(doc?.rss?.channel?.item);
  // Atom
  const atomEntries = asArray(doc?.feed?.entry);

  const raw = rssItems.length ? rssItems : atomEntries;
  const isAtom = !rssItems.length && atomEntries.length > 0;

  return raw.slice(0, MAX_ITEMS_PER_FEED).map((entry, i) => {
    const title = stripHtml(text(entry.title));
    const summary = stripHtml(
      text(entry.description ?? entry.summary ?? entry.content),
    ).slice(0, 400);
    const url = isAtom ? atomLink(entry.link) : text(entry.link);
    const publishedAt = normalizeDate(
      text(entry.pubDate ?? entry.published ?? entry.updated),
    );
    const haystack = `${title} ${summary}`;
    return {
      id: `${feed.name}-${i}`,
      title,
      source: feed.name,
      publishedAt,
      tickers: extractTickers(haystack, watch),
      summary,
      url: url || undefined,
      kind: "newsletter" as const,
    };
  });
}

function atomLink(link: unknown): string {
  for (const l of asArray(link)) {
    if (typeof l === "string") return l;
    if (l && typeof l === "object") {
      const obj = l as Record<string, unknown>;
      const rel = obj["@_rel"];
      const href = obj["@_href"];
      if ((rel === undefined || rel === "alternate") && typeof href === "string") {
        return href;
      }
    }
  }
  return "";
}

function extractTickers(haystack: string, watch: Set<string>): string[] {
  const found = new Set<string>();
  for (const c of haystack.match(/\$[A-Z]{1,5}\b/g) ?? []) found.add(c.slice(1));
  for (const sym of watch) {
    // Escape the symbol — never build a RegExp from an unsanitized string.
    if (new RegExp(`\\b${escapeRegExp(sym)}\\b`).test(haystack)) found.add(sym);
  }
  return Array.from(found);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupe(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const it of items) {
    const key = (it.url || it.title).toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function recentEnough(item: NewsItem): boolean {
  const ms = dateMs(item.publishedAt);
  if (!ms) return true; // keep undated items
  return Date.now() - ms <= RECENCY_DAYS * 86_400_000;
}

function dateMs(s: string): number {
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

function normalizeDate(s: string): string {
  const t = Date.parse(s);
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>)["#text"]);
  }
  return "";
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
