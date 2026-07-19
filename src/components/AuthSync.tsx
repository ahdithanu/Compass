"use client";

// Guards against client-side profile bleed on a shared browser. The dashboard
// caches the onboarding profile in sessionStorage so it can render immediately;
// this listener drops that cache the moment the signed-in account *changes*
// (switch or sign-out), so User B never inherits User A's cached profile.
// It intentionally does NOT clear on token refresh (same user id) — only on a
// genuine identity change — so an active session keeps its cache.

import { useEffect, useRef } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { clearAllPlanCache } from "@/lib/runCache";

const PROFILE_KEY = "compass:profile";

export default function AuthSync() {
  // undefined = not yet established; null = signed out; string = a user id.
  const lastUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null;
      if (lastUserId.current !== undefined && lastUserId.current !== uid) {
        try {
          sessionStorage.removeItem(PROFILE_KEY);
        } catch {
          /* storage unavailable — nothing to clear */
        }
        // Drop cached plans too, so a demo/other-user plan can't linger.
        clearAllPlanCache();
      }
      lastUserId.current = uid;
    });
    return () => subscription.unsubscribe();
  }, []);

  return null;
}
