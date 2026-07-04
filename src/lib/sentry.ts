// Minimal, dependency-free Sentry capture for server-side errors. Dormant until
// SENTRY_DSN is set; then it POSTs uncaught route errors to Sentry's ingest API.
// Kept SDK-free on purpose: the app already funnels every route error through
// one place (withRequest), so a small, timeout-guarded fetch is all we need.
// It never throws — monitoring must not break the request path.

import { fetchWithTimeout } from "./resilience";

interface ParsedDsn {
  host: string;
  projectId: string;
  publicKey: string;
}

/** Parse a Sentry DSN: https://<publicKey>@<host>/<projectId>. */
export function parseDsn(dsn: string | undefined): ParsedDsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\/+/, "");
    if (!u.username || !u.hostname || !projectId) return null;
    return { host: u.host, projectId, publicKey: u.username };
  } catch {
    return null;
  }
}

export function isSentryConfigured(): boolean {
  return parseDsn(process.env.SENTRY_DSN) !== null;
}

export function eventId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? uuid.replace(/-/g, "") : `${Date.now().toString(16)}`.padEnd(32, "0");
}

/** The Sentry ingest endpoint for a parsed DSN. */
export function sentryStoreUrl(dsn: ParsedDsn): string {
  return `https://${dsn.host}/api/${dsn.projectId}/store/`;
}

/** The `X-Sentry-Auth` header value for a parsed DSN. */
export function sentryAuthHeader(dsn: ParsedDsn): string {
  return `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=compass/1.0`;
}

export interface CaptureContext {
  requestId?: string;
  scope?: string;
  extra?: Record<string, unknown>;
}

/** Build a Sentry event payload from an error. Isomorphic (server + browser);
 *  `environment`/`release` resolve to undefined on the client unless provided. */
export function buildSentryEvent(
  error: unknown,
  opts: { platform: "node" | "javascript" } & CaptureContext,
): Record<string, unknown> {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    event_id: eventId(),
    timestamp: new Date().toISOString(),
    platform: opts.platform,
    level: "error",
    logger: opts.scope ?? (opts.platform === "javascript" ? "client" : "api"),
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "production",
    release:
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.NEXT_PUBLIC_RELEASE ||
      undefined,
    server_name: process.env.VERCEL_REGION || undefined,
    tags: { scope: opts.scope, request_id: opts.requestId },
    extra: { ...opts.extra, stack: err.stack },
    exception: { values: [{ type: err.name, value: err.message }] },
  };
}

/**
 * Report an error to Sentry. No-ops (and never throws) when SENTRY_DSN is unset
 * or malformed. Awaited by callers so the event isn't dropped when a serverless
 * function returns — bounded by a short timeout so it can't slow the response.
 */
export async function captureException(
  error: unknown,
  context: CaptureContext = {},
): Promise<void> {
  const dsn = parseDsn(process.env.SENTRY_DSN);
  if (!dsn) return;

  const event = buildSentryEvent(error, { platform: "node", ...context });

  try {
    await fetchWithTimeout(sentryStoreUrl(dsn), 1500, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sentry-auth": sentryAuthHeader(dsn),
      },
      body: JSON.stringify(event),
    });
  } catch {
    // Swallow — monitoring failures must never surface to the user.
  }
}
