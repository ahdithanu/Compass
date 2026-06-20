import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-20">
      <nav className="mb-20 flex items-center justify-between">
        <span className="text-lg font-bold tracking-tight">
          Compass<span style={{ color: "var(--accent)" }}>.</span>
        </span>
        <Link href="/login" className="btn-ghost text-sm">
          Sign in
        </Link>
      </nav>

      <section className="max-w-3xl">
        <p
          className="mb-4 text-sm font-semibold uppercase tracking-widest"
          style={{ color: "var(--accent)" }}
        >
          Your investing co-pilot
        </p>
        <h1 className="text-balance text-4xl font-bold leading-tight sm:text-5xl">
          Know what to track, what to watch, and what the move is — built around{" "}
          <span style={{ color: "var(--accent)" }}>you</span>.
        </h1>
        <p className="mt-6 text-lg" style={{ color: "var(--muted)" }}>
          Tell Compass your goals, age, risk appetite, and where you are in your
          journey. It tunes a living view of your markets, sectors, and specific
          names to focus on — each with a clear, sourced reason why. Update it
          anytime; it re-tunes with you.
        </p>

        <div className="mt-10 flex flex-wrap gap-4">
          <Link href="/onboarding" className="btn">
            Build my plan
          </Link>
          <Link href="/login" className="btn-ghost">
            I already have an account
          </Link>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-3">
          {[
            ["Personalized", "Allocation, sectors, and tickers tuned to your profile."],
            ["Explained", "Every recommendation comes with a grounded 'here's why'."],
            ["Verified", "A multi-stage checker audits each output before you see it."],
          ].map(([h, d]) => (
            <div key={h} className="card p-5">
              <h3 className="font-semibold">{h}</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                {d}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-16 text-xs" style={{ color: "var(--muted)" }}>
          Educational information only — not personalized financial advice.
        </p>
      </section>
    </main>
  );
}
