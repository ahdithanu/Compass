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

export const metadata: Metadata = {
  title: "Compass — your investing co-pilot",
  description:
    "A personalized dashboard that tells you what to track, what markets to watch, and what the move is — tailored to your goals, age, and journey, with a sourced why.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={sans.variable}>
      <body>{children}</body>
    </html>
  );
}
