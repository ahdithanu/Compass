"use client";

// Cloudflare Turnstile CAPTCHA, wired for Supabase Auth. Dormant until a site
// key is set (NEXT_PUBLIC_TURNSTILE_SITE_KEY): with no key it renders nothing
// and reports a null token, so auth behaves exactly as before. Set the key AND
// enable CAPTCHA in Supabase (Auth → Attack Protection) to turn it on — the
// token then flows into signInWithPassword/signUp via options.captchaToken.

import { useEffect, useRef } from "react";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** True when Turnstile is configured — the login form uses this to gate submit. */
export function isCaptchaEnabled(): boolean {
  return Boolean(SITE_KEY);
}

export default function Captcha({
  onToken,
  resetSignal = 0,
}: {
  onToken: (token: string | null) => void;
  /** Bump this to force a fresh challenge (Turnstile tokens are single-use). */
  resetSignal?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY) return;
    let cancelled = false;

    const renderWidget = () => {
      if (cancelled || !containerRef.current || widgetId.current || !window.turnstile) {
        return;
      }
      widgetId.current = window.turnstile.render(containerRef.current, {
        sitekey: SITE_KEY,
        callback: (token: string) => onToken(token),
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null),
      });
    };

    if (window.turnstile) {
      renderWidget();
    } else {
      let script = document.querySelector<HTMLScriptElement>("script[data-turnstile]");
      if (!script) {
        script = document.createElement("script");
        script.src = SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.dataset.turnstile = "true";
        document.head.appendChild(script);
      }
      script.addEventListener("load", renderWidget);
    }

    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* widget already gone */
        }
        widgetId.current = null;
      }
    };
  }, [onToken]);

  // Reset the challenge on demand (e.g. after a failed sign-in consumes the token).
  useEffect(() => {
    if (resetSignal > 0 && widgetId.current && window.turnstile) {
      window.turnstile.reset(widgetId.current);
      onToken(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  if (!SITE_KEY) return null;
  return <div ref={containerRef} className="mt-1" />;
}
