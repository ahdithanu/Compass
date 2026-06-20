// Typed client-side API helper. Centralizes the fetch → parse → error/branch
// dance every page was repeating, and surfaces the server's `x-request-id` so a
// user can quote it when something fails. Client-safe (no server imports).

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  requestId: string | null;
}

export interface ApiFailure {
  ok: false;
  error: string;
  issues?: string[];
  status: number; // 0 means the request never reached the server
  requestId: string | null;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

const NETWORK_ERROR =
  "Couldn't reach the server. Check your connection and try again.";

function defaultMessage(status: number): string {
  if (status === 401) return "Please sign in to continue.";
  if (status === 404) return "We couldn't find that.";
  if (status === 413) return "That request was too large.";
  if (status === 429) return "You're going a bit fast — wait a moment and retry.";
  if (status >= 500) return "Something went wrong on our end.";
  return "Something went wrong.";
}

export async function apiRequest<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    return { ok: false, error: NETWORK_ERROR, status: 0, requestId: null };
  }

  const requestId = res.headers.get("x-request-id");

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined; // empty or non-JSON response
  }
  const rec =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      requestId,
      error: typeof rec.error === "string" ? rec.error : defaultMessage(res.status),
      issues: Array.isArray(rec.issues)
        ? rec.issues.filter((i): i is string => typeof i === "string")
        : undefined,
    };
  }

  return { ok: true, data: body as T, requestId };
}

export function apiGet<T>(url: string): Promise<ApiResult<T>> {
  return apiRequest<T>(url);
}

export function apiPost<T>(url: string, json?: unknown): Promise<ApiResult<T>> {
  return apiRequest<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(json ?? {}),
  });
}

export function apiDelete<T>(url: string): Promise<ApiResult<T>> {
  return apiRequest<T>(url, { method: "DELETE" });
}

/** Append a support reference id to a message when one is available. */
export function withRef(message: string, requestId: string | null): string {
  return requestId ? `${message} (ref: ${requestId})` : message;
}
