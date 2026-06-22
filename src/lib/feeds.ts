// Per-user newsletter feed management: validation (with SSRF guards) and the
// DB helpers used by the /api/feeds routes and the insights pipeline.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeedSource } from "./sources";
import type { Database, Tables } from "./supabase/database.types";

/** A Supabase client typed against our generated schema. */
export type TypedClient = SupabaseClient<Database>;

export interface FeedValidation {
  ok: boolean;
  feed?: FeedSource;
  error?: string;
}

// Hostnames / IP ranges we refuse to fetch server-side. User-supplied URLs are
// fetched by our server, so an unguarded URL is an SSRF vector (cloud metadata,
// internal services, loopback). We normalize the host and parse IPs in every
// notation (dotted/decimal/hex/octal, IPv4-mapped IPv6) so encoding tricks like
// http://2852039166/ or http://[::ffff:169.254.169.254]/ can't slip through.
// DNS-rebinding (a public name that re-resolves to a private IP at fetch time)
// is still out of scope — mitigated in practice by re-validating redirect hops.

function isBlockedIPv4(n: number): boolean {
  const a = (n >>> 24) & 0xff;
  const b = (n >>> 16) & 0xff;
  if (a === 0) return true; // 0.0.0.0/8 (incl. http://0/)
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function parseIntFlexible(s: string): number | null {
  if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s, 16);
  if (/^0[0-7]+$/.test(s)) return parseInt(s, 8);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return null;
}

/** Parse an IPv4 host in decimal/hex/octal, dotted or single-integer form. */
function parseIPv4(host: string): number | null {
  const parts = host.split(".");
  if (parts.length === 1) {
    const n = parseIntFlexible(parts[0]);
    return n !== null && n >= 0 && n <= 0xffffffff ? n >>> 0 : null;
  }
  if (parts.length === 4) {
    let acc = 0;
    for (const p of parts) {
      const n = parseIntFlexible(p);
      if (n === null || n < 0 || n > 255) return null;
      acc = ((acc << 8) | n) >>> 0;
    }
    return acc;
  }
  return null;
}

// Extract an embedded IPv4 (as a 32-bit int) from an IPv6 literal, covering the
// forms that wrap a v4 address: IPv4-mapped (::ffff:a.b.c.d / ::ffff:aabb:ccdd),
// IPv4-compatible (::a.b.c.d / ::aabb:ccdd), and NAT64 (64:ff9b::a.b.c.d). Only
// these prefixes are mined for hex-embedded v4 so ordinary public IPv6 isn't
// false-positived. Returns null when there's no embedded v4 to check.
function extractEmbeddedV4(h: string): number | null {
  const dotted = h.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return parseIPv4(dotted[1]);
  if (h.startsWith("::ffff:") || h.startsWith("64:ff9b:") || /^::[0-9a-f]/.test(h)) {
    const groups = h.split(":").filter((g) => g.length > 0);
    if (groups.length >= 2) {
      const hiS = groups[groups.length - 2];
      const loS = groups[groups.length - 1];
      if (/^[0-9a-f]{1,4}$/.test(hiS) && /^[0-9a-f]{1,4}$/.test(loS)) {
        const hi = parseInt(hiS, 16);
        const lo = parseInt(loS, 16);
        return (((hi << 16) >>> 0) + lo) >>> 0;
      }
    }
  }
  return null;
}

export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h === "metadata.google.internal") return true;

  // IPv6
  if (h.includes(":")) {
    if (/^0*(:0*)*$/.test(h)) return true; // unspecified ::
    if (h === "::1" || /^(0*:)*0*1$/.test(h)) return true; // loopback (any expansion)
    if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true; // link-local / ULA
    const embedded = extractEmbeddedV4(h); // mapped / compatible / NAT64 → check the v4
    if (embedded !== null) return isBlockedIPv4(embedded);
    return false;
  }

  // IPv4 in any numeric notation
  const v4 = parseIPv4(h);
  if (v4 !== null) return isBlockedIPv4(v4);

  return false;
}

/** Validate a user-submitted feed. Enforces http(s) + the SSRF host blocklist. */
export function validateFeed(nameRaw: unknown, urlRaw: unknown): FeedValidation {
  const url = typeof urlRaw === "string" ? urlRaw.trim() : "";
  if (!url) return { ok: false, error: "A feed URL is required." };
  // Cap length before parsing — a sane URL is well under this; longer is abuse.
  if (url.length > 2048) return { ok: false, error: "That feed URL is too long." };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only http(s) feed URLs are allowed." };
  }
  if (isBlockedHost(parsed.hostname)) {
    return { ok: false, error: "That host isn't allowed." };
  }

  const name =
    (typeof nameRaw === "string" && nameRaw.trim()) ||
    parsed.hostname.replace(/^www\./, "");

  return {
    ok: true,
    feed: { name: name.slice(0, 80), url: parsed.toString() },
  };
}

/** A row from the generated `user_feeds` schema. */
export type UserFeedRow = Tables<"user_feeds">;

/** Load a user's saved feeds as FeedSource[] (empty if none). */
export async function getUserFeeds(
  db: TypedClient,
  userId: string,
): Promise<FeedSource[]> {
  const { data } = await db
    .from("user_feeds")
    .select("id, name, url, category")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  return (data ?? []).map((r) => ({
    name: r.name,
    url: r.url,
    category: r.category ?? undefined,
  }));
}
