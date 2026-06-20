// Small HTTP helpers shared by the API route handlers: a body-size cap (so a
// caller can't make us buffer/parse a huge payload) and a standard 429 response.

import { NextResponse } from "next/server";
import type { RateLimitResult } from "./ratelimit";

// Profiles and feed payloads are tiny; 16 KB is generous headroom while still
// rejecting anything pathological before we parse it.
export const MAX_BODY_BYTES = 16 * 1024;

export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body too large.");
    this.name = "BodyTooLargeError";
  }
}

/**
 * Read and JSON-parse a request body, rejecting anything over `maxBytes`.
 * Throws `BodyTooLargeError` when too large, `SyntaxError` on malformed JSON,
 * and returns `undefined` for an empty body. Callers decide how to treat each.
 */
export async function readJsonCapped(
  request: Request,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > maxBytes) throw new BodyTooLargeError();

  const text = await request.text();
  // Byte length (not string length) is the real wire size.
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new BodyTooLargeError();
  if (!text) return undefined;
  return JSON.parse(text);
}

/** Standard 413 response for an over-cap body. */
export function bodyTooLargeResponse(): NextResponse {
  return NextResponse.json({ error: "Request body too large." }, { status: 413 });
}

/** Standard 429 response carrying a Retry-After header. */
export function rateLimitedResponse(rl: RateLimitResult): NextResponse {
  return NextResponse.json(
    { error: "Too many requests. Please slow down." },
    { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
  );
}
