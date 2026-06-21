import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// Branded favicon: a green tile with a bold "C".
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#00c805",
          color: "#0b0e0f",
          fontSize: 23,
          fontWeight: 800,
          fontFamily: "sans-serif",
          borderRadius: 7,
        }}
      >
        C
      </div>
    ),
    { ...size },
  );
}
