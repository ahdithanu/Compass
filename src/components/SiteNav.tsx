"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** Sticky top nav: frosts on scroll, collapses to a menu on mobile. */
export default function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const solid = scrolled || open;
  const frost = solid ? "saturate(180%) blur(10px)" : "none";

  return (
    <header
      className="sticky top-0 z-50 transition-all duration-200"
      style={{
        background: solid ? "rgba(255,255,255,0.8)" : "transparent",
        backdropFilter: frost,
        WebkitBackdropFilter: frost,
        borderBottom: `1px solid ${solid ? "var(--border)" : "transparent"}`,
      }}
    >
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          onClick={() => setOpen(false)}
          className="text-lg font-bold tracking-tight"
        >
          Compass<span style={{ color: "var(--accent)" }}>.</span>
        </Link>

        {/* Desktop actions */}
        <div className="hidden items-center gap-2 sm:flex">
          <Link href="/login" className="btn-ghost text-sm">
            Sign in
          </Link>
          <Link href="/onboarding" className="btn text-sm">
            Build my plan
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          className="sm:hidden"
          aria-label="Menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          style={{ color: "var(--text)" }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            {open ? (
              <>
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </>
            ) : (
              <>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            )}
          </svg>
        </button>
      </nav>

      {/* Mobile menu panel */}
      {open && (
        <div className="sm:hidden" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="mx-auto flex max-w-5xl flex-col gap-2 px-6 py-4">
            <Link
              href="/onboarding"
              className="btn text-center"
              onClick={() => setOpen(false)}
            >
              Build my plan
            </Link>
            <Link
              href="/login"
              className="btn-ghost text-center"
              onClick={() => setOpen(false)}
            >
              Sign in
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
