import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
