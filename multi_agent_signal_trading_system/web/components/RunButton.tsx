"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runPipelineFromBrowser } from "@/lib/api";

export function RunButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  const onClick = () =>
    start(async () => {
      setStatus("running");
      try {
        await runPipelineFromBrowser();
        setStatus("ok");
        router.refresh();
        setTimeout(() => setStatus(null), 1500);
      } catch (e) {
        setStatus(`error: ${(e as Error).message}`);
      }
    });

  return (
    <button
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-md bg-accent-500/20 hover:bg-accent-500/30 border border-accent-500/40 text-accent-500 text-xs font-semibold px-3 py-1.5 transition disabled:opacity-50"
    >
      {pending ? (
        <span className="inline-block w-3 h-3 rounded-full bg-accent-500 animate-pulse" />
      ) : (
        <span>↻</span>
      )}
      {status === "running" ? "Running pipeline…" : status === "ok" ? "Refreshed ✓" : "Re-run pipeline"}
    </button>
  );
}
