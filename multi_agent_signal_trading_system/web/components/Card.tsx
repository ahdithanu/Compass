import { ReactNode } from "react";

export function Card({
  title,
  subtitle,
  children,
  right,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="rounded-xl bg-ink-800 border border-ink-600 p-5 shadow-sm">
      {(title || right) && (
        <header className="flex items-start justify-between mb-3">
          <div>
            {title && <h2 className="text-sm font-semibold tracking-wide uppercase text-slate-300">{title}</h2>}
            {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  delta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: "neutral" | "good" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-400"
      : tone === "bad"
      ? "text-rose-400"
      : "text-slate-100";
  return (
    <div className="rounded-lg bg-ink-700 border border-ink-600 px-4 py-3">
      <div className="text-xs text-slate-400 uppercase tracking-wide">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
      {delta && <div className="mt-0.5 text-xs text-slate-500">{delta}</div>}
    </div>
  );
}
