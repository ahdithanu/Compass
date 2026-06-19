// CRUD for a signed-in user's newsletter feeds.
//   GET    -> list feeds
//   POST   -> add a feed { name?, url } (validated, SSRF-guarded)
//   DELETE -> remove a feed (?id=...)

import { NextResponse } from "next/server";
import { validateFeed } from "@/lib/feeds";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

async function requireUser() {
  if (!isSupabaseConfigured()) return { error: "config" as const };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "auth" as const };
  return { supabase, user };
}

export async function GET() {
  const ctx = await requireUser();
  if ("error" in ctx) return NextResponse.json({ feeds: [] });

  const { data, error } = await ctx.supabase
    .from("user_feeds")
    .select("id, name, url, category, created_at")
    .eq("user_id", ctx.user.id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Failed to load feeds." }, { status: 500 });
  }
  return NextResponse.json({ feeds: data ?? [] });
}

export async function POST(request: Request) {
  const ctx = await requireUser();
  if ("error" in ctx) {
    return NextResponse.json({ error: "Sign in to manage feeds." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { name, url } = (body ?? {}) as { name?: unknown; url?: unknown };

  const v = validateFeed(name, url);
  if (!v.ok || !v.feed) {
    return NextResponse.json({ error: v.error ?? "Invalid feed." }, { status: 400 });
  }

  const { data, error } = await ctx.supabase
    .from("user_feeds")
    .insert({
      user_id: ctx.user.id,
      name: v.feed.name,
      url: v.feed.url,
      category: v.feed.category ?? null,
    })
    .select("id, name, url, category, created_at")
    .single();

  if (error) {
    // Unique violation -> the user already has this feed.
    if (error.code === "23505") {
      return NextResponse.json({ error: "You already added that feed." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to add feed." }, { status: 500 });
  }
  return NextResponse.json({ feed: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  const ctx = await requireUser();
  if ("error" in ctx) {
    return NextResponse.json({ error: "Sign in to manage feeds." }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing feed id." }, { status: 400 });

  const { error } = await ctx.supabase
    .from("user_feeds")
    .delete()
    .eq("id", id)
    .eq("user_id", ctx.user.id);

  if (error) {
    return NextResponse.json({ error: "Failed to remove feed." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
