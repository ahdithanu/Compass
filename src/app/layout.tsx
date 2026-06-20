import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

// Anthropic-style pairing: a warm display serif (Fraunces) for headings and a
// clean grotesque (Inter) for body text. Exposed as CSS variables so globals.css
// drives where each is applied.
const serif = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
  axes: ["opsz"],
});

const sans = Inter({
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
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
