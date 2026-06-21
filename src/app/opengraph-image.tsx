import { ImageResponse } from "next/og";

export const alt = "Compass — your investing co-pilot";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Branded social-share card: dark canvas + Robinhood green, matching the site.
// Note: satori requires display:flex on any element with multiple children, so
// each text line is a single text node (no inline <span>s).
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "90px",
          background: "#0b0e0f",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 44, fontWeight: 800, letterSpacing: "-0.02em" }}>
          Compass
          <span style={{ color: "#00c805" }}>.</span>
        </div>
        <div
          style={{
            fontSize: 68,
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: "-0.03em",
            marginTop: 44,
            maxWidth: 980,
          }}
        >
          Know what to track, what to watch, and what the move is — built around
          you.
        </div>
        <div style={{ fontSize: 30, color: "#00c805", marginTop: 36 }}>
          Your personalized investing co-pilot
        </div>
      </div>
    ),
    { ...size },
  );
}
