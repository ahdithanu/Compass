// Minimal structured observability. Every pipeline run gets a trace id; each
// stage emits a single structured log line. This is the seam where a real
// telemetry backend (OpenTelemetry, Datadog, etc.) would plug in later.

export function newTraceId(): string {
  return (
    "trc_" +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}

export interface TraceEvent {
  traceId?: string;
  requestId?: string;
  stage: string;
  event: string;
  ok?: boolean;
  detail?: string;
  ms?: number;
}

export function logEvent(e: TraceEvent): void {
  // Structured single-line JSON — trivially parseable by a log shipper.
  console.log(JSON.stringify({ t: new Date().toISOString(), ...e }));
}

/** Wraps an async stage, logging its start/end and duration under the trace. */
export async function tracedStage<T>(
  traceId: string,
  stage: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    logEvent({ traceId, stage, event: "completed", ok: true, ms: Date.now() - start });
    return result;
  } catch (err) {
    logEvent({
      traceId,
      stage,
      event: "failed",
      ok: false,
      ms: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
