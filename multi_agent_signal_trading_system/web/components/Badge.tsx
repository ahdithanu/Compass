import type { Rating } from "@/lib/api";

export function RatingBadge({ rating }: { rating: Rating }) {
  const cls =
    rating === "BUY"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : rating === "HOLD"
      ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
      : "bg-rose-500/15 text-rose-300 border-rose-500/30";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${cls}`}
    >
      {rating}
    </span>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 70 ? "text-emerald-300" : score >= 50 ? "text-amber-300" : "text-rose-300";
  return (
    <span className={`font-semibold ${tone}`}>
      {Number.isFinite(score) ? score.toFixed(0) : "—"}
    </span>
  );
}

export function FlagPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] bg-ink-700 border border-ink-500 text-slate-300">
      {label}
    </span>
  );
}
