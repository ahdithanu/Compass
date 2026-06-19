// Live happy-path smoke test for the per-user feeds feature.
//
// Unlike the hermetic route tests (tests/api-routes.test.ts), this exercises the
// REAL `user_feeds` table on a live Supabase project: the columns, the RLS
// policies (writes scoped to auth.uid()) and the (user_id, url) unique
// constraint. It signs in a real user with supabase-js and runs the full
// insert -> list -> duplicate -> delete -> verify-gone round trip the
// /api/feeds route relies on.
//
// It is excluded from the default suite/CI and self-skips unless all four env
// vars below are set. To run it:
//
//   1. Apply supabase/schema.sql (creates user_feeds + policies).
//   2. Create a confirmed test user in the project's Auth section.
//   3. Export the env and run:
//        NEXT_PUBLIC_SUPABASE_URL=...        \
//        NEXT_PUBLIC_SUPABASE_ANON_KEY=...   \
//        SMOKE_TEST_EMAIL=you@example.com    \
//        SMOKE_TEST_PASSWORD=...             \
//        npm run test:integration

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.SMOKE_TEST_EMAIL;
const password = process.env.SMOKE_TEST_PASSWORD;
const READY = Boolean(url && anon && email && password);

// A unique URL per run keeps the test idempotent and avoids colliding with real
// user data (it's also cleaned up in afterAll).
const TEST_URL = `https://smoke.example.com/feed-${Date.now()}.xml`;

describe.skipIf(!READY)("user_feeds (live integration)", () => {
  let db: SupabaseClient;
  let userId: string;

  beforeAll(async () => {
    db = createClient(url!, anon!, { auth: { persistSession: false } });
    const { data, error } = await db.auth.signInWithPassword({
      email: email!,
      password: password!,
    });
    if (error || !data.user) {
      throw new Error(`Sign-in failed for ${email}: ${error?.message ?? "no user"}`);
    }
    userId = data.user.id;
    // Belt-and-suspenders cleanup in case a previous run left this URL behind.
    await db.from("user_feeds").delete().eq("user_id", userId).eq("url", TEST_URL);
  });

  afterAll(async () => {
    if (db && userId) {
      await db.from("user_feeds").delete().eq("user_id", userId).eq("url", TEST_URL);
      await db.auth.signOut();
    }
  });

  it("inserts a feed and reads it back (RLS-scoped to the signed-in user)", async () => {
    const { data, error } = await db
      .from("user_feeds")
      .insert({ user_id: userId, name: "Smoke Letter", url: TEST_URL, category: "macro" })
      .select("id, name, url, category, user_id")
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    expect(data?.name).toBe("Smoke Letter");
    expect(data?.url).toBe(TEST_URL);
    expect(data?.category).toBe("macro");
    expect(data?.user_id).toBe(userId);

    const { data: list } = await db
      .from("user_feeds")
      .select("url")
      .eq("user_id", userId);
    expect(list?.some((r) => r.url === TEST_URL)).toBe(true);
  });

  it("rejects a duplicate (user_id, url) with a unique violation", async () => {
    const { error } = await db
      .from("user_feeds")
      .insert({ user_id: userId, name: "Dupe", url: TEST_URL });
    expect(error?.code).toBe("23505");
  });

  it("deletes the feed and confirms it's gone", async () => {
    const { error } = await db
      .from("user_feeds")
      .delete()
      .eq("user_id", userId)
      .eq("url", TEST_URL);
    expect(error).toBeNull();

    const { data: after } = await db
      .from("user_feeds")
      .select("id")
      .eq("user_id", userId)
      .eq("url", TEST_URL);
    expect(after ?? []).toHaveLength(0);
  });
});
