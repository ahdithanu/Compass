"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { InsightDigest, Recommendation } from "@/lib/types";
import { apiGet, apiPost, withRef } from "@/lib/apiClient";

interface RunSummary {
  id: string;
  kind: "recommendation" | "insights";
  reasoning_source: string;
  data_source: string;
  checks_passed: number;
  checks_total: number;
  created_at: string;
}

interface RunDetail {
  id: string;
  kind: "recommendation" | "insights";
  reasoning_source: string;
  data_source: string;
  created_at: string;
  payload: Recommendation | InsightDigest;
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
    const payload = profile ? { profile } : {};

    (async () => {
      const r = await apiPost<{ recommendation: Recommendation }>(
        "/api/recommendations",
        payload,
      );
      if (!r.ok) {
        setError(withRef(r.error, r.requestId));
        setIssues(r.issues ?? []);
      } else {
        setRec(r.data.recommendation);
      }
      setLoading(false);
    })();

    // Insights load independently — a failure here shouldn't block the plan.
    (async () => {
      const r = await apiPost<{ digest: InsightDigest }>("/api/insights", payload);
      if (r.ok) setDigest(r.data.digest);
    })();

    // History is best-effort and only populated for signed-in users. Refetch
    // shortly after so the run we just generated shows up.
    const loadHistory = async () => {
      const r = await apiGet<{ runs: RunSummary[] }>("/api/history");
      if (r.ok && Array.isArray(r.data.runs)) setHistory(r.data.runs);
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

/** Collapsible run history. Each row opens the full stored run in a modal. */
function HistoryPanel({ runs }: { runs: RunSummary[] }) {
  const [open, setOpen] = useState(false);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
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
            <li key={r.id}>
              <button
                className="lift flex w-full items-center justify-between rounded-lg px-3 py-2 text-left"
                style={{ background: "var(--panel-2)" }}
                onClick={() => setOpenRunId(r.id)}
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
                  {r.checks_passed}/{r.checks_total} checks · {r.reasoning_source} ·{" "}
                  <span style={{ color: "var(--accent)" }}>open →</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {openRunId && (
        <RunDetailModal runId={openRunId} onClose={() => setOpenRunId(null)} />
      )}
    </section>
  );
}

/** Fetch and render the full payload of one past run, read-only, in an overlay. */
function RunDetailModal({
  runId,
  onClose,
}: {
  runId: string;
  onClose: () => void;
}) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const r = await apiGet<{ run: RunDetail }>(
        `/api/history?id=${encodeURIComponent(runId)}`,
      );
      if (!active) return;
      if (r.ok && r.data.run) setRun(r.data.run);
      else if (r.ok) setError("Run not found.");
      else setError(withRef(r.error, r.requestId));
    })();
    return () => {
      active = false;
    };
  }, [runId]);

  // Close on Escape for keyboard users.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={onClose}
    >
      <div
        className="card w-full max-w-3xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="label">
            {run
              ? `${run.kind === "recommendation" ? "Recommendation" : "Insights"} · ${new Date(
                  run.created_at,
                ).toLocaleString()}`
              : "Loading run…"}
          </span>
          <button className="btn-ghost text-sm" onClick={onClose}>
            Close
          </button>
        </div>

        {error && (
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        {!run && !error && (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Loading…
          </p>
        )}

        {run && run.kind === "recommendation" && (
          <RecommendationSections rec={run.payload as Recommendation} />
        )}
        {run && run.kind === "insights" && (
          <InsightsView digest={run.payload as InsightDigest} />
        )}
      </div>
    </div>
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

/** The reusable body of a recommendation — used live and for past runs. */
function RecommendationSections({ rec }: { rec: Recommendation }) {
  return (
    <div className="space-y-6">
      <TheMoveSection rec={rec} />
      <AllocationSection rec={rec} />
      <PicksSection rec={rec} />
      <SectorsSection rec={rec} />
      <ChecksPanel rec={rec} />
      <DisclaimersFooter rec={rec} />
    </div>
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
      <TheMoveSection rec={rec} />

      {/* Insights digest (best-effort; renders when ready) */}
      {digest && <InsightsView digest={digest} />}

      <AllocationSection rec={rec} />
      <PicksSection rec={rec} />
      <SectorsSection rec={rec} />

      {/* Checker audit panel — surfaces the multi-stage verification */}
      <ChecksPanel rec={rec} />

      {/* Run history (signed-in users only) */}
      {history.length > 0 && <HistoryPanel runs={history} />}

      <DisclaimersFooter rec={rec} />
    </div>
  );
}

function TheMoveSection({ rec }: { rec: Recommendation }) {
  return (
    <section className="card p-6">
      <p className="label" style={{ color: "var(--accent)" }}>
        What&apos;s the move
      </p>
      <h2 className="mt-2 text-3xl font-extrabold">{rec.theMove.headline}</h2>
      <p className="mt-3" style={{ color: "var(--muted)" }}>
        {rec.theMove.reasoning}
      </p>
      <p className="mt-4 text-sm">{rec.summary}</p>
    </section>
  );
}

function AllocationSection({ rec }: { rec: Recommendation }) {
  return (
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
  );
}

function PicksSection({ rec }: { rec: Recommendation }) {
  return (
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
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-semibold tabular-nums">
                    ${p.price.toFixed(2)}
                  </span>
                  {p.changePercent != null && (
                    <span
                      className={`change ${p.changePercent >= 0 ? "change-up" : "change-down"}`}
                    >
                      {p.changePercent >= 0 ? "▲" : "▼"}
                      {Math.abs(p.changePercent).toFixed(2)}%
                    </span>
                  )}
                </div>
              )}
            </div>
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              {p.rationale}
            </p>
            <span className={`mt-2 ${bucketPill(p.bucket)}`}>{p.bucket}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SectorsSection({ rec }: { rec: Recommendation }) {
  return (
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
  );
}

function DisclaimersFooter({ rec }: { rec: Recommendation }) {
  return (
    <footer className="space-y-1 px-2 pb-2 text-xs" style={{ color: "var(--muted)" }}>
      {rec.disclaimers.map((d) => (
        <p key={d}>{d}</p>
      ))}
    </footer>
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
    { v: rec.allocation.stocks, c: "var(--accent-dim)" },
    { v: rec.allocation.bonds, c: "var(--chart-bonds)" },
    { v: rec.allocation.cash, c: "var(--chart-cash)" },
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

/** Map a pick's bucket to a tinted pill class. */
function bucketPill(bucket: string): string {
  const b = bucket.toLowerCase();
  if (b.includes("growth")) return "pill pill-green";
  if (b.includes("defensive") || b.includes("bond")) return "pill pill-slate";
  if (b.includes("income") || b.includes("dividend")) return "pill pill-amber";
  return "pill";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: "var(--panel-2)" }}>
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        {label}
      </p>
      <p className="text-2xl font-extrabold tracking-tight">{value}</p>
    </div>
  );
}
