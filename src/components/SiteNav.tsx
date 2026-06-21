"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** Sticky top nav that gains a frosted background + border once you scroll. */
export default function SiteNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="sticky top-0 z-50 transition-all duration-200"
      style={{
        background: scrolled ? "rgba(255,255,255,0.8)" : "transparent",
        backdropFilter: scrolled ? "saturate(180%) blur(10px)" : "none",
        WebkitBackdropFilter: scrolled ? "saturate(180%) blur(10px)" : "none",
        borderBottom: `1px solid ${scrolled ? "var(--border)" : "transparent"}`,
      }}
    >
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Compass<span style={{ color: "var(--accent)" }}>.</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/login" className="btn-ghost text-sm">
            Sign in
          </Link>
          <Link href="/onboarding" className="btn text-sm">
            Build my plan
          </Link>
        </div>
      </nav>
    </header>
  );
}
