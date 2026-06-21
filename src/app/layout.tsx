import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

// Robinhood-style typography: one bold geometric grotesque used everywhere,
// leaning on heavy weights + tight tracking for big confident headlines.
const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const DESCRIPTION =
  "A personalized dashboard that tells you what to track, what markets to watch, and what the move is — tailored to your goals, age, and journey, with a sourced why.";

export const metadata: Metadata = {
  metadataBase: new URL("https://trading-bots-indol.vercel.app"),
  title: "Compass — your investing co-pilot",
  description: DESCRIPTION,
  openGraph: {
    title: "Compass — your investing co-pilot",
    description: DESCRIPTION,
    siteName: "Compass",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Compass — your investing co-pilot",
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={sans.variable}>
      <head>
        {/* Without JS, reveal-wrapped content must still be visible. */}
        <noscript>
          <style>{`.reveal{opacity:1 !important;transform:none !important}`}</style>
        </noscript>
      </head>
      <body>{children}</body>
    </html>
  );
}
