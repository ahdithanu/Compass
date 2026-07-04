"use client";

// Captures uncaught browser errors and unhandled promise rejections and reports
// them to Sentry (via sentryClient, which no-ops unless NEXT_PUBLIC_SENTRY_DSN
// is set). Render errors are caught separately by the app/error.tsx boundary.

import { useEffect } from "react";
import { reportClientError } from "@/lib/sentryClient";

export default function ClientErrorMonitor() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      reportClientError(e.error ?? new Error(e.message), {
        source: e.filename,
        line: e.lineno,
        col: e.colno,
      });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason =
        e.reason instanceof Error ? e.reason : new Error(String(e.reason));
      reportClientError(reason, { kind: "unhandledrejection" });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
