import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { RunButton } from "@/components/RunButton";

export const metadata: Metadata = {
  title: "Multi-Agent Signal Research",
  description:
    "Explainable investment memos, risk reviews, and a paper-trading backtest produced by a multi-agent signal pipeline.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-ink-600 bg-ink-800/80 backdrop-blur sticky top-0 z-10">
            <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
              <div className="flex items-center gap-6">
                <a href="/" className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-accent-500" />
                  <span className="font-semibold tracking-tight">Signal Research</span>
                  <span className="text-xs text-slate-500 hidden sm:inline">
                    multi-agent pipeline
                  </span>
                </a>
                <Nav />
              </div>
              <RunButton />
            </div>
          </header>
          <main className="flex-1 max-w-7xl mx-auto px-6 py-6 w-full">{children}</main>
          <footer className="border-t border-ink-600 text-xs text-slate-500 py-4 text-center">
            Education and paper-trading simulation only · not investment advice
          </footer>
        </div>
      </body>
    </html>
  );
}
