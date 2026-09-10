"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0d0f12",
          color: "#fff",
          fontFamily: "system-ui, -apple-system, sans-serif",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <p
          style={{
            fontSize: 11,
            letterSpacing: "0.5em",
            textTransform: "uppercase",
            color: "#ff5722",
            fontWeight: 700,
          }}
        >
          Critical Error
        </p>
        <h1 style={{ fontSize: "clamp(28px,6vw,48px)", fontWeight: 900, margin: "16px 0 8px" }}>
          The lanterns went out
        </h1>
        <p style={{ color: "#8E95A5", maxWidth: 420, lineHeight: 1.6, fontSize: 14 }}>
          A critical failure occurred and the page could not be restored
          automatically. Please try reloading.
        </p>
        {error.digest && (
          <p style={{ color: "#555", fontFamily: "monospace", fontSize: 10, marginTop: 12 }}>
            ref: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          style={{
            marginTop: 28,
            background: "#ff5722",
            color: "#fff",
            border: "none",
            padding: "16px 32px",
            fontSize: 11,
            fontWeight: 900,
            letterSpacing: "0.25em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
