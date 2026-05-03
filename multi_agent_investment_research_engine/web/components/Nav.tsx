"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/rankings", label: "Rankings" },
  { href: "/memo", label: "Memo" },
  { href: "/outbound", label: "Outbound" },
  { href: "/risk", label: "Risk" },
  { href: "/backtest", label: "Backtest" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {links.map((l) => {
        const active = pathname === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`px-3 py-1.5 rounded-md text-sm transition ${
              active
                ? "bg-ink-700 text-white"
                : "text-slate-400 hover:text-white hover:bg-ink-700/60"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
