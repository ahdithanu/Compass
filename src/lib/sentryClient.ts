// Browser-side Sentry reporting. Dormant until NEXT_PUBLIC_SENTRY_DSN is set.
// Uses the ingest endpoint's query-string auth so requests are simple (no
// preflight) and prefers sendBeacon so events survive page unload. Capped per
// page session so a render loop can't flood Sentry (or the network).

import { parseDsn, sentryStoreUrl, buildSentryEvent } from "./sentry";

const MAX_EVENTS_PER_SESSION = 10;
let sent = 0;

/** Report a client-side error to Sentry. No-ops when unconfigured or over cap. */
export function reportClientError(
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  // Read at call time so it's testable; Next inlines the value in the browser.
  const dsn = parseDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);
  if (!dsn || sent >= MAX_EVENTS_PER_SESSION) return;
  if (typeof window === "undefined") return;
  sent++;

  const event = buildSentryEvent(error, {
    platform: "javascript",
    scope: "client",
    extra: {
      url: window.location?.href,
      userAgent: navigator.userAgent,
      ...extra,
    },
  });
  const body = JSON.stringify(event);

  // Query-string auth keeps the request "simple" → no CORS preflight.
  const url =
    `${sentryStoreUrl(dsn)}?sentry_version=7&sentry_key=${dsn.publicKey}` +
    `&sentry_client=compass%2F1.0`;

  try {
    if (navigator.sendBeacon && navigator.sendBeacon(url, body)) return;
  } catch {
    /* fall through to fetch */
  }
  // keepalive lets the POST outlive the page; text/plain avoids a preflight.
  void fetch(url, {
    method: "POST",
    body,
    keepalive: true,
    headers: { "content-type": "text/plain;charset=UTF-8" },
  }).catch(() => {
    /* monitoring must never surface to the user */
  });
}

/** Test-only: reset the per-session counter. */
export function __resetClientErrorCount(): void {
  sent = 0;
}
