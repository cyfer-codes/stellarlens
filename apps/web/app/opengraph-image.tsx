import { ImageResponse } from "next/og";

export const alt = "stellarlens — index, decode and monitor Soroban contract events";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Statically rendered to a PNG at build time and served at /opengraph-image,
// which Next wires into the og:image tags for every route.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#111827",
          color: "#ffffff"
        }}
      >
        <div style={{ fontSize: 96, fontWeight: 700, letterSpacing: "-0.02em" }}>stellarlens</div>
        <div style={{ marginTop: 24, fontSize: 40, color: "#d1d5db" }}>
          Index, decode and monitor Soroban contract events.
        </div>
        <div style={{ marginTop: 48, fontSize: 28, color: "#facc15" }}>
          Dashboard · REST api · Signed webhooks · SDK · CLI
        </div>
      </div>
    ),
    size
  );
}
