"use client";

// App Router error boundary: catches render/runtime errors in the page tree,
// reports them to Sentry (no-op unless configured), and shows a recoverable
// fallback instead of a blank screen.

import { useEffect } from "react";
import Link from "next/link";
import { reportClientError } from "@/lib/sentryClient";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error, { digest: error.digest, boundary: "app/error" });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="card p-6">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          An unexpected error interrupted this page. You can try again, or head
          back to your dashboard.
        </p>
        <div className="mt-5 flex gap-2">
          <button className="btn text-sm" onClick={reset}>
            Try again
          </button>
          <Link href="/dashboard" className="btn-ghost text-sm">
            Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
