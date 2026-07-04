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

function eventId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? uuid.replace(/-/g, "") : `${Date.now().toString(16)}`.padEnd(32, "0");
}

export interface CaptureContext {
  requestId?: string;
  scope?: string;
  extra?: Record<string, unknown>;
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

  const err = error instanceof Error ? error : new Error(String(error));
  const event = {
    event_id: eventId(),
    timestamp: new Date().toISOString(),
    platform: "node",
    level: "error",
    logger: context.scope ?? "api",
    environment:
      process.env.VERCEL_ENV || process.env.NODE_ENV || "production",
    release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    server_name: process.env.VERCEL_REGION || undefined,
    tags: { scope: context.scope, request_id: context.requestId },
    extra: { ...context.extra, stack: err.stack },
    exception: {
      values: [{ type: err.name, value: err.message }],
    },
  };

  const endpoint = `https://${dsn.host}/api/${dsn.projectId}/store/`;
  const auth = `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=compass/1.0`;

  try {
    await fetchWithTimeout(endpoint, 1500, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sentry-auth": auth },
      body: JSON.stringify(event),
    });
  } catch {
    // Swallow — monitoring failures must never surface to the user.
  }
}
