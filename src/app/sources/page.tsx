"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

interface Feed {
  id: string;
  name: string;
  url: string;
  category: string | null;
}

export default function SourcesPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!isSupabaseConfigured()) {
        setAuthed(false);
        return;
      }
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setAuthed(Boolean(user));
      if (user) {
        const res = await fetch("/api/feeds");
        const data = await res.json();
        if (res.ok) setFeeds(data.feeds ?? []);
      }
    })();
  }, []);

  async function addFeed(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() || undefined, url: url.trim() }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not add feed.");
      return;
    }
    setFeeds((f) => [...f, data.feed]);
    setName("");
    setUrl("");
  }

  async function removeFeed(id: string) {
    const prev = feeds;
    setFeeds((f) => f.filter((x) => x.id !== id));
    const res = await fetch(`/api/feeds?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) setFeeds(prev); // rollback on failure
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/dashboard" className="text-lg font-bold tracking-tight">
          Compass<span style={{ color: "var(--accent)" }}>.</span>
        </Link>
        <Link href="/dashboard" className="btn-ghost text-sm">
          Back to dashboard
        </Link>
      </header>

      <h1 className="text-3xl font-bold">Your sources</h1>
      <p className="mt-2" style={{ color: "var(--muted)" }}>
        Add the newsletters and RSS feeds you actually read. Compass ingests them
        and folds them into your insights digest. Until you add any, it uses a
        curated default set.
      </p>

      {authed === false && (
        <div className="card mt-8 p-6">
          <p style={{ color: "var(--muted)" }}>
            {isSupabaseConfigured()
              ? "Sign in to save your own sources."
              : "Sign-in isn't configured in this environment, so custom sources can't be saved yet."}
          </p>
          {isSupabaseConfigured() && (
            <Link href="/login" className="btn mt-4 inline-block">
              Sign in
            </Link>
          )}
        </div>
      )}

      {authed && (
        <>
          <form onSubmit={addFeed} className="card mt-8 space-y-4 p-6">
            <div>
              <label className="label">Feed URL</label>
              <input
                className="input mt-1"
                placeholder="https://example.com/feed.xml"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Name (optional)</label>
              <input
                className="input mt-1"
                placeholder="Defaults to the site name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {error && (
              <p className="text-sm" style={{ color: "var(--danger)" }}>
                {error}
              </p>
            )}
            <button className="btn" disabled={busy}>
              {busy ? "Adding…" : "Add source"}
            </button>
          </form>

          <div className="mt-6 space-y-2">
            {feeds.length === 0 && (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                No custom sources yet — using the default market feeds.
              </p>
            )}
            {feeds.map((f) => (
              <div
                key={f.id}
                className="card flex items-center justify-between p-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{f.name}</p>
                  <p className="truncate text-xs" style={{ color: "var(--muted)" }}>
                    {f.url}
                  </p>
                </div>
                <button
                  className="btn-ghost text-sm"
                  onClick={() => removeFeed(f.id)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
