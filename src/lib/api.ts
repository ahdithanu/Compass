// Request-scoped wrapper for API route handlers. Gives every response a stable
// `x-request-id` (honoring a client-supplied one so callers can correlate),
// emits a structured request/response log line, and centralizes uncaught-error
// handling so a thrown handler becomes a clean 500 — with the id echoed in the
// body for support/debugging.

import { NextResponse } from "next/server";
import { logEvent } from "./observability";

export type ApiHandler = (
  request: Request,
  ctx: { requestId: string },
) => Promise<NextResponse> | NextResponse;

export function newRequestId(): string {
  return "req_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Reuse a sane client-provided correlation id, else mint a fresh one. */
export function requestIdFrom(request: Request): string {
  const incoming = request.headers.get("x-request-id");
  if (incoming && /^[\w.-]{1,128}$/.test(incoming)) return incoming;
  return newRequestId();
}

/**
 * Wrap a route handler with request-id tagging + structured logging. The id is
 * set on every response (success or error) and passed to the handler via ctx.
 */
export function withRequest(scope: string, handler: ApiHandler) {
  return async (request: Request): Promise<NextResponse> => {
    const requestId = requestIdFrom(request);
    const start = Date.now();
    logEvent({ requestId, stage: `api:${scope}`, event: "request", detail: request.method });

    try {
      const res = await handler(request, { requestId });
      res.headers.set("x-request-id", requestId);
      logEvent({
        requestId,
        stage: `api:${scope}`,
        event: "response",
        ok: res.status < 500,
        ms: Date.now() - start,
        detail: String(res.status),
      });
      return res;
    } catch (err) {
      logEvent({
        requestId,
        stage: `api:${scope}`,
        event: "error",
        ok: false,
        ms: Date.now() - start,
        detail: err instanceof Error ? err.message : String(err),
      });
      const res = NextResponse.json(
        { error: "Internal server error.", requestId },
        { status: 500 },
      );
      res.headers.set("x-request-id", requestId);
      return res;
    }
  };
}
