import Link from "next/link";
import Reveal from "@/components/Reveal";
import SiteNav from "@/components/SiteNav";

const FEATURES: [string, string][] = [
  ["Personalized", "Allocation, sectors, and tickers tuned to your profile."],
  ["Explained", "Every recommendation comes with a grounded 'here's why'."],
  ["Verified", "A multi-stage checker audits each output before you see it."],
];

const HOW = [
  ["01", "Tell it about you", "Age, goals, risk appetite, and where you are in your journey — about 30 seconds."],
  ["02", "It builds your plan", "A target allocation, sectors to watch, and specific names — all tuned to your profile."],
  ["03", "See the why, verified", "Every pick comes with a sourced rationale that clears a multi-stage checker first."],
];

const STATS = [
  ["5-stage", "verification pipeline runs behind every recommendation"],
  ["100% grounded", "in your real allocation and market data — no invented tickers"],
  ["2 passes", "an analyst writes the why; an independent critic audits it"],
];

const FAQ: [string, string][] = [
  [
    "Is this financial advice?",
    "No. Compass is educational — it shows how a plan could be structured for a profile like yours, with sources for the reasoning. Always do your own research or consult a licensed financial advisor before investing.",
  ],
  [
    "Where do the recommendations come from?",
    "A deterministic engine chooses the allocation and instruments from your profile. A reasoning layer then writes the “why” around those picks, and an independent checker audits it before you ever see it — it never invents tickers or numbers.",
  ],
  [
    "Do I need an account?",
    "No — you can build a plan immediately. Sign in only if you want to save your profile, your custom sources, and your run history across visits.",
  ],
  [
    "How current is the market data?",
    "With live data connected, quotes and news refresh from market sources. Without it, Compass runs on representative sample data so the full experience still works end-to-end.",
  ],
];

export default function Home() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-5xl px-6 pb-16 pt-10 sm:pb-20">
      {/* Hero — two columns on desktop: copy on the left, product preview on the right */}
      <section className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <p
            className="mb-4 text-sm font-semibold uppercase tracking-widest"
            style={{ color: "var(--accent)" }}
          >
            Your investing co-pilot
          </p>
          <h1 className="text-balance text-4xl font-bold leading-tight sm:text-5xl">
            Know what to track, what to watch, and what the move is — built
            around <span style={{ color: "var(--accent)" }}>you</span>.
          </h1>
          <p className="mt-6 text-lg" style={{ color: "var(--muted)" }}>
            Tell Compass your goals, age, risk appetite, and where you are in
            your journey. It tunes a living view of your markets, sectors, and
            specific names to focus on — each with a clear, sourced reason why.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link href="/onboarding" className="btn">
              Build my plan
            </Link>
            <Link href="/login" className="btn-dark">
              I already have an account
            </Link>
          </div>
        </div>

        <Reveal delay={80}>
          <ProductPreview />
        </Reveal>
      </section>

      {/* Feature trio — staggered reveal */}
      <section className="mt-20 grid gap-4 sm:grid-cols-3">
        {FEATURES.map(([h, d], i) => (
          <Reveal key={h} delay={i * 90}>
            <div className="card lift h-full p-5">
              <h3 className="font-semibold">{h}</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                {d}
              </p>
            </div>
          </Reveal>
        ))}
      </section>

      {/* How it works */}
      <section className="mt-24">
        <Reveal>
          <div>
            <p className="label" style={{ color: "var(--accent)" }}>
              How it works
            </p>
            <h2 className="mt-2 text-3xl font-extrabold sm:text-4xl">
              From profile to plan in three steps.
            </h2>
          </div>
        </Reveal>
        <div className="mt-10 grid gap-5 sm:grid-cols-3">
          {HOW.map(([n, h, d], i) => (
            <Reveal key={n} delay={i * 90}>
              <div className="card lift h-full p-6">
                <div className="text-2xl font-extrabold" style={{ color: "var(--accent)" }}>
                  {n}
                </div>
                <h3 className="mt-3 text-lg font-bold">{h}</h3>
                <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                  {d}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Pull-quote — the product's own stance, not a fabricated testimonial */}
      <Reveal>
        <section className="mt-24 text-center">
          <p className="mx-auto max-w-3xl text-2xl font-bold leading-snug sm:text-3xl">
            “Most apps tell you what&apos;s moving. Compass tells you what&apos;s
            moving <span style={{ color: "var(--accent)" }}>for you</span> — and
            exactly why.”
          </p>
          <p className="label mt-5" style={{ color: "var(--muted)" }}>
            The Compass principle
          </p>
        </section>
      </Reveal>

      {/* Trust band — Robinhood-style black/green panel */}
      <Reveal>
        <section className="mt-24">
          <div
            className="grid gap-8 rounded-2xl p-10 sm:grid-cols-3"
            style={{ background: "var(--text)", color: "#ffffff" }}
          >
            {STATS.map(([big, small]) => (
              <div key={big}>
                <div
                  className="text-3xl font-extrabold tracking-tight sm:text-4xl"
                  style={{ color: "var(--accent-dim)" }}
                >
                  {big}
                </div>
                <p className="mt-2 text-sm" style={{ color: "rgba(255,255,255,0.72)" }}>
                  {small}
                </p>
              </div>
            ))}
          </div>
        </section>
      </Reveal>

      {/* FAQ */}
      <Reveal>
        <section className="mt-24">
          <p className="label" style={{ color: "var(--accent)" }}>
            Questions
          </p>
          <h2 className="mt-2 text-3xl font-extrabold sm:text-4xl">
            The honest answers.
          </h2>
          <div className="mt-8 space-y-3">
            {FAQ.map(([q, a]) => (
              <details key={q} className="card p-5">
                <summary className="cursor-pointer font-semibold">{q}</summary>
                <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
                  {a}
                </p>
              </details>
            ))}
          </div>
        </section>
      </Reveal>

      {/* Closing CTA */}
      <Reveal>
        <section className="mt-24 text-center">
          <h2 className="text-3xl font-extrabold sm:text-4xl">
            Your plan is 30 seconds away.
          </h2>
          <p className="mx-auto mt-3 max-w-xl" style={{ color: "var(--muted)" }}>
            No account required to start. Build a plan on the spot and see
            exactly what Compass would track for you.
          </p>
          <div className="mt-6 flex justify-center gap-4">
            <Link href="/onboarding" className="btn">
              Build my plan
            </Link>
            <Link href="/login" className="btn-dark">
              Sign in
            </Link>
          </div>
        </section>
      </Reveal>

      <footer
        className="mt-20 border-t pt-8 pb-10 text-xs"
        style={{ borderColor: "var(--border)", color: "var(--muted)" }}
      >
        Educational information only — not personalized financial advice. All
        investing carries risk, including possible loss of principal.
      </footer>
      </main>
    </>
  );
}

/** Illustrative dashboard mockup shown in the hero. Static, clearly labeled. */
function ProductPreview() {
  return (
    <div>
      <div className="card lift">
        <div
          className="flex items-center gap-1.5 border-b px-5 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#ff5f57" }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#febc2e" }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#28c840" }} />
          <span className="ml-3 text-xs" style={{ color: "var(--muted)" }}>
            compass · your plan
          </span>
        </div>
        <div className="p-6">
          <p className="label" style={{ color: "var(--accent)" }}>
            Target allocation
          </p>
          <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full">
            <div style={{ width: "60%", background: "var(--accent-dim)" }} />
            <div style={{ width: "25%", background: "var(--chart-bonds)" }} />
            <div style={{ width: "10%", background: "var(--chart-cash)" }} />
            <div style={{ width: "5%", background: "var(--warn)" }} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Stocks", "60%"],
              ["Bonds", "25%"],
              ["Cash", "10%"],
              ["Alts", "5%"],
            ].map(([l, v]) => (
              <div key={l} className="rounded-xl p-3" style={{ background: "var(--panel-2)" }}>
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  {l}
                </p>
                <p className="text-2xl font-extrabold tracking-tight">{v}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 space-y-2">
            {[
              ["VTI", "Vanguard Total US Stock ETF", "$295.40", "▲ 0.32%", "change-up"],
              ["SCHD", "Schwab US Dividend Equity ETF", "$79.10", "▼ 0.18%", "change-down"],
            ].map(([t, n, p, c, cls]) => (
              <div
                key={t}
                className="flex items-center justify-between gap-3 rounded-xl p-4"
                style={{ background: "var(--panel-2)" }}
              >
                <div className="min-w-0 truncate">
                  <span className="font-bold">{t}</span>{" "}
                  <span className="text-sm" style={{ color: "var(--muted)" }}>
                    {n}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-sm">
                  <span className="font-semibold tabular-nums">{p}</span>
                  <span className={`change ${cls}`}>{c}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-xs" style={{ color: "var(--muted)" }}>
        Illustrative preview — your real plan is generated from your profile.
      </p>
    </div>
  );
}
