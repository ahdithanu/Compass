"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { InsightDigest, Recommendation } from "@/lib/types";

interface RunSummary {
  id: string;
  kind: "recommendation" | "insights";
  reasoning_source: string;
  data_source: string;
  checks_passed: number;
  checks_total: number;
  created_at: string;
}

export default function DashboardPage() {
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [digest, setDigest] = useState<InsightDigest | null>(null);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored =
      typeof window !== "undefined"
        ? sessionStorage.getItem("compass:profile")
        : null;
    const profile = stored ? JSON.parse(stored) : null;
    const body = JSON.stringify(profile ? { profile } : {});
    const opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    };

    (async () => {
      try {
        const res = await fetch("/api/recommendations", opts);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Something went wrong.");
          setIssues(data.issues ?? []);
          return;
        }
        setRec(data.recommendation);
      } catch {
        setError("Could not reach the recommendation service.");
      } finally {
        setLoading(false);
      }
    })();

    // Insights load independently — a failure here shouldn't block the plan.
    (async () => {
      try {
        const res = await fetch("/api/insights", opts);
        const data = await res.json();
        if (res.ok) setDigest(data.digest);
      } catch {
        /* insights are best-effort */
      }
    })();

    // History is best-effort and only populated for signed-in users. Refetch
    // shortly after so the run we just generated shows up.
    const loadHistory = async () => {
      try {
        const res = await fetch("/api/history");
        const data = await res.json();
        if (res.ok && Array.isArray(data.runs)) setHistory(data.runs);
      } catch {
        /* history is best-effort */
      }
    };
    loadHistory();
    const t = setTimeout(loadHistory, 2500);
    return () => clearTimeout(t);
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Compass<span style={{ color: "var(--accent)" }}>.</span>
        </Link>
        <div className="flex gap-2">
          <Link href="/sources" className="btn-ghost text-sm">
            Sources
          </Link>
          <Link href="/onboarding" className="btn-ghost text-sm">
            Update my profile
          </Link>
        </div>
      </header>

      {loading && <p style={{ color: "var(--muted)" }}>Building your plan…</p>}

      {error && (
        <div className="card p-6">
          <h2 className="font-semibold" style={{ color: "var(--danger)" }}>
            {error}
          </h2>
          {issues.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm" style={{ color: "var(--muted)" }}>
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
          <Link href="/onboarding" className="btn mt-5 inline-block">
            Back to onboarding
          </Link>
        </div>
      )}

      {rec && <RecommendationView rec={rec} digest={digest} history={history} />}
    </main>
  );
}

function HistoryPanel({ runs }: { runs: RunSummary[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card p-6">
      <button
        className="flex w-full items-center justify-between"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="label">Run history</span>
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          {runs.length} saved {runs.length === 1 ? "run" : "runs"} · {open ? "hide" : "show"}
        </span>
      </button>
      {open && (
        <ul className="mt-4 space-y-2 text-sm">
          {runs.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between rounded-lg px-3 py-2"
              style={{ background: "var(--panel-2)" }}
            >
              <span>
                <span className="font-medium">
                  {r.kind === "recommendation" ? "Recommendation" : "Insights"}
                </span>
                <span style={{ color: "var(--muted)" }}>
                  {" "}· {new Date(r.created_at).toLocaleString()}
                </span>
              </span>
              <span style={{ color: "var(--muted)" }}>
                {r.checks_passed}/{r.checks_total} checks · {r.reasoning_source}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function InsightsView({ digest }: { digest: InsightDigest }) {
  return (
    <section className="card p-6">
      <p className="label" style={{ color: "var(--accent)" }}>
        What&apos;s moving — for you
      </p>
      <h2 className="mt-2 text-xl font-bold">{digest.headline}</h2>
      <div className="mt-4 space-y-3">
        {digest.insights.map((ins, i) => {
          const cited = digest.sources.filter((s) =>
            ins.sourceIds.includes(s.id),
          );
          return (
            <div
              key={i}
              className="rounded-xl p-4"
              style={{ background: "var(--panel-2)" }}
            >
              <h3 className="font-semibold">{ins.title}</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                {ins.summary}
              </p>
              <p className="mt-2 text-sm">
                <span style={{ color: "var(--accent)" }}>So what: </span>
                {ins.soWhat}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {ins.relatedTickers.map((t) => (
                  <span
                    key={t}
                    className="rounded-md px-2 py-0.5 text-xs"
                    style={{ background: "var(--border)", color: "var(--muted)" }}
                  >
                    {t}
                  </span>
                ))}
                {cited.map((s) => {
                  const label =
                    s.kind === "newsletter" ? `📩 ${s.source}` : s.source;
                  return s.url ? (
                    <a
                      key={s.id}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs underline"
                      style={{ color: "var(--muted)" }}
                    >
                      {label}
                    </a>
                  ) : (
                    <span key={s.id} className="text-xs" style={{ color: "var(--muted)" }}>
                      {label}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs" style={{ color: "var(--muted)" }}>
        {digest.meta.checks.filter((c) => c.passed).length}/
        {digest.meta.checks.length} checks passed ·{" "}
        {digest.meta.reasoningSource === "claude" ? "Claude-synthesized" : "rule-based"} ·{" "}
        {digest.meta.dataSource === "live" ? "live news" : "sample news"}
      </p>
    </section>
  );
}

function RecommendationView({
  rec,
  digest,
  history,
}: {
  rec: Recommendation;
  digest: InsightDigest | null;
  history: RunSummary[];
}) {
  return (
    <div className="space-y-6">
      {/* The move */}
      <section className="card p-6">
        <p className="label" style={{ color: "var(--accent)" }}>
          What&apos;s the move
        </p>
        <h2 className="mt-2 text-2xl font-bold">{rec.theMove.headline}</h2>
        <p className="mt-3" style={{ color: "var(--muted)" }}>
          {rec.theMove.reasoning}
        </p>
        <p className="mt-4 text-sm">{rec.summary}</p>
      </section>

      {/* Insights digest (best-effort; renders when ready) */}
      {digest && <InsightsView digest={digest} />}

      {/* Allocation */}
      <section className="card p-6">
        <p className="label mb-3">Target allocation</p>
        <AllocationBar rec={rec} />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Stocks" value={`${rec.allocation.stocks}%`} />
          <Stat label="Bonds" value={`${rec.allocation.bonds}%`} />
          <Stat label="Cash" value={`${rec.allocation.cash}%`} />
          <Stat label="Alternatives" value={`${rec.allocation.alternatives}%`} />
        </div>
      </section>

      {/* Picks */}
      <section className="card p-6">
        <p className="label mb-4">Names to focus on</p>
        <div className="space-y-3">
          {rec.picks.map((p) => (
            <div
              key={p.ticker}
              className="rounded-xl p-4"
              style={{ background: "var(--panel-2)" }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <span className="font-bold">{p.ticker}</span>{" "}
                  <span className="text-sm" style={{ color: "var(--muted)" }}>
                    {p.name}
                  </span>
                </div>
                {p.price != null && (
                  <div className="text-right text-sm">
                    <span>${p.price.toFixed(2)}</span>{" "}
                    <span
                      style={{
                        color:
                          (p.changePercent ?? 0) >= 0
                            ? "var(--accent)"
                            : "var(--danger)",
                      }}
                    >
                      {(p.changePercent ?? 0) >= 0 ? "+" : ""}
                      {(p.changePercent ?? 0).toFixed(2)}%
                    </span>
                  </div>
                )}
              </div>
              <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                {p.rationale}
              </p>
              <span
                className="mt-2 inline-block rounded-md px-2 py-0.5 text-xs"
                style={{ background: "var(--border)", color: "var(--muted)" }}
              >
                {p.bucket}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Sectors */}
      <section className="card p-6">
        <p className="label mb-4">Sectors to watch</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {rec.sectorsToWatch.map((s) => (
            <div key={s.sector} className="rounded-xl p-4" style={{ background: "var(--panel-2)" }}>
              <h3 className="font-semibold">{s.sector}</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                {s.why}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Checker audit panel — surfaces the multi-stage verification */}
      <ChecksPanel rec={rec} />

      {/* Run history (signed-in users only) */}
      {history.length > 0 && <HistoryPanel runs={history} />}

      {/* Disclaimers */}
      <footer className="space-y-1 px-2 pb-8 text-xs" style={{ color: "var(--muted)" }}>
        {rec.disclaimers.map((d) => (
          <p key={d}>{d}</p>
        ))}
      </footer>
    </div>
  );
}

function ChecksPanel({ rec }: { rec: Recommendation }) {
  const [open, setOpen] = useState(false);
  const passed = rec.meta.checks.filter((c) => c.passed).length;
  const total = rec.meta.checks.length;
  return (
    <section className="card p-6">
      <button
        className="flex w-full items-center justify-between"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="label">Verification & sources</span>
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          {passed}/{total} checks passed ·{" "}
          {rec.meta.reasoningSource === "claude" ? "Claude-reasoned" : "rule-based"} ·{" "}
          {rec.meta.dataSource === "live" ? "live data" : "sample data"} ·{" "}
          {open ? "hide" : "show"}
        </span>
      </button>
      {open && (
        <ul className="mt-4 space-y-2 text-sm">
          {rec.meta.checks.map((c, i) => (
            <li key={i} className="flex items-start gap-2">
              <span style={{ color: c.passed ? "var(--accent)" : "var(--danger)" }}>
                {c.passed ? "✓" : "✕"}
              </span>
              <span>
                <span className="font-medium">{c.name}</span>
                <span style={{ color: "var(--muted)" }}> ({c.stage})</span>
                {c.detail && (
                  <span style={{ color: "var(--muted)" }}> — {c.detail}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AllocationBar({ rec }: { rec: Recommendation }) {
  const segs = [
    { v: rec.allocation.stocks, c: "var(--accent)" },
    { v: rec.allocation.bonds, c: "#60a5fa" },
    { v: rec.allocation.cash, c: "#a78bfa" },
    { v: rec.allocation.alternatives, c: "var(--warn)" },
  ];
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full">
      {segs.map((s, i) => (
        <div key={i} style={{ width: `${s.v}%`, background: s.c }} />
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: "var(--panel-2)" }}>
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        {label}
      </p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}
