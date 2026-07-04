"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { InsightDigest, Recommendation } from "@/lib/types";
import { apiGet, apiPost, withRef } from "@/lib/apiClient";
import { diffRuns, type AllocationDelta } from "@/lib/compare";
import { evidenceForTicker } from "@/lib/explain";
import AccountMenu from "@/components/AccountMenu";

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
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    const stored =
      typeof window !== "undefined"
        ? sessionStorage.getItem("compass:profile")
        : null;
    const profile = stored ? JSON.parse(stored) : null;
    const payload = profile ? { profile } : {};

    (async () => {
      const r = await apiPost<{ recommendation: Recommendation; demo?: boolean }>(
        "/api/recommendations",
        payload,
      );
      if (!r.ok) {
        setError(withRef(r.error, r.requestId));
        setIssues(r.issues ?? []);
      } else {
        setRec(r.data.recommendation);
        setDemo(Boolean(r.data.demo));
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
      <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Compass<span style={{ color: "var(--accent)" }}>.</span>
        </Link>
        <nav className="flex flex-wrap gap-2 sm:justify-end">
          <Link href="/projection" className="btn-ghost whitespace-nowrap text-sm">
            Projection
          </Link>
          <Link href="/rebalance" className="btn-ghost whitespace-nowrap text-sm">
            Rebalance
          </Link>
          <Link href="/sources" className="btn-ghost whitespace-nowrap text-sm">
            Sources
          </Link>
          <Link href="/onboarding" className="btn-ghost whitespace-nowrap text-sm">
            Update my profile
          </Link>
          <AccountMenu />
        </nav>
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

      {demo && rec && (
        <div
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl p-4"
          style={{ background: "var(--panel-2)", boxShadow: "inset 0 0 0 1px var(--border)" }}
        >
          <p className="text-sm">
            <span className="font-semibold">Sample plan.</span>{" "}
            <span style={{ color: "var(--muted)" }}>
              You&apos;re viewing a demo built from a default profile. Set yours to
              personalize everything.
            </span>
          </p>
          <Link href="/onboarding" className="btn text-sm">
            Set my profile
          </Link>
        </div>
      )}

      {rec && <RecommendationView rec={rec} digest={digest} history={history} />}
    </main>
  );
}

/** Collapsible run history. Rows open the full stored run; in compare mode you
 *  pick two recommendation runs to diff what changed between them. */
function HistoryPanel({ runs }: { runs: RunSummary[] }) {
  const [open, setOpen] = useState(false);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparePair, setComparePair] = useState<[string, string] | null>(null);

  // Only recommendation runs carry an allocation, so only they're comparable.
  const recRuns = runs.filter((r) => r.kind === "recommendation");
  const canCompare = recRuns.length >= 2;

  function toggleSelect(id: string) {
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= 2) return [cur[1], id]; // keep the most recent two picks
      return [...cur, id];
    });
  }

  function startCompare() {
    if (selected.length !== 2) return;
    // Order older -> newer so deltas read as "how the newer plan changed".
    const byId = new Map(runs.map((r) => [r.id, r]));
    const [a, b] = selected;
    const older =
      new Date(byId.get(a)!.created_at) <= new Date(byId.get(b)!.created_at) ? a : b;
    const newer = older === a ? b : a;
    setComparePair([older, newer]);
  }

  function exitCompare() {
    setCompareMode(false);
    setSelected([]);
  }

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
        <>
          {canCompare && (
            <div className="mt-4 flex items-center justify-between gap-3">
              {compareMode ? (
                <>
                  <span className="text-sm" style={{ color: "var(--muted)" }}>
                    Pick two recommendation runs · {selected.length}/2 selected
                  </span>
                  <span className="flex gap-2">
                    <button
                      className="btn text-sm disabled:opacity-50"
                      disabled={selected.length !== 2}
                      onClick={startCompare}
                    >
                      Compare →
                    </button>
                    <button className="btn-ghost text-sm" onClick={exitCompare}>
                      Cancel
                    </button>
                  </span>
                </>
              ) : (
                <button
                  className="btn-ghost text-sm"
                  onClick={() => setCompareMode(true)}
                >
                  Compare two runs
                </button>
              )}
            </div>
          )}

          <ul className="mt-4 space-y-2 text-sm">
            {runs.map((r) => {
              const isRec = r.kind === "recommendation";
              const picked = selected.includes(r.id);
              const selectable = compareMode && isRec;
              return (
                <li key={r.id}>
                  <button
                    className="lift flex w-full items-center justify-between rounded-lg px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-40"
                    style={{
                      background: picked ? "var(--accent)" : "var(--panel-2)",
                      color: picked ? "#fff" : "var(--text)",
                    }}
                    disabled={compareMode && !isRec}
                    onClick={() =>
                      compareMode ? selectable && toggleSelect(r.id) : setOpenRunId(r.id)
                    }
                  >
                    <span>
                      <span className="font-medium">
                        {isRec ? "Recommendation" : "Insights"}
                      </span>
                      <span style={{ color: picked ? "rgba(255,255,255,0.8)" : "var(--muted)" }}>
                        {" "}· {new Date(r.created_at).toLocaleString()}
                      </span>
                    </span>
                    <span style={{ color: picked ? "rgba(255,255,255,0.8)" : "var(--muted)" }}>
                      {r.checks_passed}/{r.checks_total} checks · {r.reasoning_source} ·{" "}
                      <span style={{ color: picked ? "#fff" : "var(--accent)" }}>
                        {compareMode ? (picked ? "selected" : "select") : "open →"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {comparePair && (
        <ComparisonModal
          olderId={comparePair[0]}
          newerId={comparePair[1]}
          onClose={() => {
            setComparePair(null);
            exitCompare();
          }}
        />
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

/** Fetch two recommendation runs and render what changed between them. */
function ComparisonModal({
  olderId,
  newerId,
  onClose,
}: {
  olderId: string;
  newerId: string;
  onClose: () => void;
}) {
  const [pair, setPair] = useState<{
    older: Recommendation;
    newer: Recommendation;
    olderAt: string;
    newerAt: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [a, b] = await Promise.all([
        apiGet<{ run: RunDetail }>(`/api/history?id=${encodeURIComponent(olderId)}`),
        apiGet<{ run: RunDetail }>(`/api/history?id=${encodeURIComponent(newerId)}`),
      ]);
      if (!active) return;
      if (a.ok && b.ok && a.data.run && b.data.run) {
        setPair({
          older: a.data.run.payload as Recommendation,
          newer: b.data.run.payload as Recommendation,
          olderAt: a.data.run.created_at,
          newerAt: b.data.run.created_at,
        });
      } else {
        setError("Couldn't load both runs to compare.");
      }
    })();
    return () => {
      active = false;
    };
  }, [olderId, newerId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cmp = pair ? diffRuns(pair.older, pair.newer) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={onClose}
    >
      <div className="card w-full max-w-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <span className="label">What changed</span>
          <button className="btn-ghost text-sm" onClick={onClose}>
            Close
          </button>
        </div>

        {error && (
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
        {!pair && !error && (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Loading…
          </p>
        )}

        {pair && cmp && (
          <>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {new Date(pair.olderAt).toLocaleDateString()} →{" "}
              {new Date(pair.newerAt).toLocaleDateString()}
            </p>

            {cmp.unchanged && (
              <p className="mt-4 text-sm">
                No changes — same target mix and the same names both times.
              </p>
            )}

            <div className="mt-5">
              <p className="label mb-3">Allocation shift</p>
              <div className="space-y-2">
                {cmp.allocation.map((d) => (
                  <AllocationDeltaRow key={d.key} d={d} />
                ))}
              </div>
            </div>

            {(cmp.added.length > 0 || cmp.removed.length > 0) && (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <PickChangeList
                  title="Added"
                  items={cmp.added}
                  color="var(--accent)"
                  prefix="+"
                />
                <PickChangeList
                  title="Removed"
                  items={cmp.removed}
                  color="var(--danger)"
                  prefix="−"
                  strike
                />
              </div>
            )}

            {cmp.held.length > 0 && (
              <p className="mt-5 text-xs" style={{ color: "var(--muted)" }}>
                Held throughout: {cmp.held.map((p) => p.ticker).join(", ")}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function AllocationDeltaRow({ d }: { d: AllocationDelta }) {
  const label = d.key.charAt(0).toUpperCase() + d.key.slice(1);
  const color =
    d.delta > 0 ? "var(--accent)" : d.delta < 0 ? "var(--danger)" : "var(--muted)";
  const sign = d.delta > 0 ? "+" : d.delta < 0 ? "−" : "";
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="font-medium">{label}</span>
      <span className="flex items-center gap-3">
        <span className="tabular-nums" style={{ color: "var(--muted)" }}>
          {d.from}% → {d.to}%
        </span>
        <span
          className="w-14 text-right font-semibold tabular-nums"
          style={{ color }}
        >
          {d.delta === 0 ? "—" : `${sign}${Math.abs(d.delta)} pts`}
        </span>
      </span>
    </div>
  );
}

function PickChangeList({
  title,
  items,
  color,
  prefix,
  strike,
}: {
  title: string;
  items: { ticker: string; name: string }[];
  color: string;
  prefix: string;
  strike?: boolean;
}) {
  return (
    <div>
      <p className="label mb-2">
        {title} ({items.length})
      </p>
      {items.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          None
        </p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {items.map((p) => (
            <li key={p.ticker} className="flex items-baseline gap-2">
              <span className="font-semibold" style={{ color }}>
                {prefix}
              </span>
              <span>
                <span
                  className="font-medium"
                  style={strike ? { textDecoration: "line-through" } : undefined}
                >
                  {p.ticker}
                </span>{" "}
                <span style={{ color: "var(--muted)" }}>{p.name}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
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
      <PicksSection rec={rec} digest={digest} />
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

function PicksSection({
  rec,
  digest,
}: {
  rec: Recommendation;
  digest?: InsightDigest | null;
}) {
  return (
    <section className="card p-6">
      <p className="label mb-4">Names to focus on</p>
      <div className="space-y-3">
        {rec.picks.map((p) => (
          <PickCard key={p.ticker} pick={p} digest={digest} />
        ))}
      </div>
    </section>
  );
}

function PickCard({
  pick: p,
  digest,
}: {
  pick: Recommendation["picks"][number];
  digest?: InsightDigest | null;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const evidence = evidenceForTicker(p.ticker, digest);
  const hasWhy = evidence.insights.length > 0 || evidence.sources.length > 0;

  return (
    <div className="rounded-xl p-4" style={{ background: "var(--panel-2)" }}>
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
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className={bucketPill(p.bucket)}>{p.bucket}</span>
        {hasWhy && (
          <button
            className="text-xs font-medium"
            style={{ color: "var(--accent)" }}
            onClick={() => setShowWhy((s) => !s)}
          >
            {showWhy ? "Hide why" : `Why this pick (${evidence.insights.length + evidence.sources.length})`}
          </button>
        )}
      </div>

      {showWhy && hasWhy && (
        <div
          className="mt-3 space-y-2 rounded-lg p-3 text-sm"
          style={{ background: "var(--bg)", boxShadow: "inset 0 0 0 1px var(--border)" }}
        >
          {evidence.insights.map((ins, i) => (
            <div key={i}>
              <p className="font-medium">{ins.title}</p>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {ins.soWhat}
              </p>
            </div>
          ))}
          {evidence.sources.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {evidence.sources.map((s) =>
                s.url ? (
                  <a
                    key={s.id}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline"
                    style={{ color: "var(--muted)" }}
                    title={s.title}
                  >
                    {s.source}
                  </a>
                ) : (
                  <span
                    key={s.id}
                    className="text-xs"
                    style={{ color: "var(--muted)" }}
                    title={s.title}
                  >
                    {s.source}
                  </span>
                ),
              )}
            </div>
          )}
        </div>
      )}
    </div>
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
