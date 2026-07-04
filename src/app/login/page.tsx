"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import Captcha, { isCaptchaEnabled } from "@/components/Captcha";

export default function LoginPage() {
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [msg, setMsg] = useState<{ text: string; kind: "error" | "info" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    // captchaToken is only required when Supabase-side CAPTCHA is enabled; when
    // it isn't, passing undefined is a no-op.
    const options = captchaToken ? { captchaToken } : undefined;
    const fn =
      mode === "signin"
        ? supabase.auth.signInWithPassword({ email, password, options })
        : supabase.auth.signUp({ email, password, options });
    const { error } = await fn;
    setBusy(false);
    if (error) {
      setMsg({ text: error.message, kind: "error" });
      // Turnstile tokens are single-use — force a fresh challenge before retry.
      if (isCaptchaEnabled()) setCaptchaReset((n) => n + 1);
      return;
    }
    if (mode === "signup") {
      setMsg({ text: "Check your email to confirm, then sign in.", kind: "info" });
      return;
    }
    // Drop any cached profile from a previous user on this browser so the
    // freshly signed-in user loads *their* saved profile, not the last one's.
    try {
      sessionStorage.removeItem("compass:profile");
    } catch {
      /* ignore */
    }
    router.push("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-8 text-lg font-bold tracking-tight">
        Compass<span style={{ color: "var(--accent)" }}>.</span>
      </Link>

      {!configured ? (
        <div className="card p-6">
          <h1 className="text-xl font-semibold">Demo mode</h1>
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
            Supabase isn&apos;t configured yet, so sign-in is disabled. You can
            still build a plan — it runs fully on sample data.
          </p>
          <Link href="/onboarding" className="btn mt-5 inline-block">
            Build my plan
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="card space-y-4 p-6">
          <h1 className="text-xl font-semibold">
            {mode === "signin" ? "Sign in" : "Create account"}
          </h1>
          <div>
            <label className="label">Email</label>
            <input
              className="input mt-1"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              className="input mt-1"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Captcha onToken={setCaptchaToken} resetSignal={captchaReset} />
          {msg && (
            <p
              className="text-sm"
              style={{ color: msg.kind === "error" ? "var(--danger)" : "var(--positive)" }}
            >
              {msg.text}
            </p>
          )}
          <button
            className="btn w-full"
            disabled={busy || (isCaptchaEnabled() && !captchaToken)}
          >
            {busy ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
          </button>
          <button
            type="button"
            className="w-full text-sm"
            style={{ color: "var(--muted)" }}
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin"
              ? "Need an account? Sign up"
              : "Have an account? Sign in"}
          </button>
        </form>
      )}
    </main>
  );
}
