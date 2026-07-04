"use client";

// Header account control: shows the signed-in email + a Sign out button, or a
// Sign in link when anonymous. Sign out clears the cached profile so the next
// user on this browser starts clean.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

const PROFILE_KEY = "compass:profile";

export default function AccountMenu() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setReady(true);
      return;
    }
    const supabase = createClient();
    let active = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!active) return;
      setEmail(user?.email ?? null);
      setReady(true);
    })();
    // Keep the indicator in sync if auth changes while this page is open.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    setBusy(true);
    try {
      sessionStorage.removeItem(PROFILE_KEY);
    } catch {
      /* ignore */
    }
    if (isSupabaseConfigured()) {
      await createClient().auth.signOut();
    }
    router.push("/");
    router.refresh();
  }

  if (!ready || !isSupabaseConfigured()) return null;

  if (!email) {
    return (
      <Link href="/login" className="btn-ghost whitespace-nowrap text-sm">
        Sign in
      </Link>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span
        className="hidden max-w-[12rem] truncate text-sm sm:inline"
        style={{ color: "var(--muted)" }}
        title={email}
      >
        {email}
      </span>
      <button
        className="btn-ghost whitespace-nowrap text-sm disabled:opacity-50"
        onClick={signOut}
        disabled={busy}
      >
        {busy ? "…" : "Sign out"}
      </button>
    </span>
  );
}
