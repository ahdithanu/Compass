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
// internal services, loopback). This is a best-effort block on the literal host;
// DNS-rebinding is out of scope for now.
function isBlockedHost(hostname: string): boolean {
  // Strip IPv6 brackets (URL.hostname keeps them, e.g. "[::1]") and a trailing dot.
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h === "metadata.google.internal") return true;

  // IPv6 loopback / link-local / unique-local
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) {
    return true;
  }

  // IPv4 literal in a private / loopback / link-local / metadata range
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
  }
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
