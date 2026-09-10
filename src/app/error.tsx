"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw, Home, Bug } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-[#0d0f12] px-6 text-center">
      {/* ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_40%_at_50%_35%,rgba(255,87,34,0.09),transparent_70%)]"
      />

      <div className="relative z-10 max-w-lg">
        <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.5em] text-flame">
          <Bug className="h-4 w-4" />
          Something derailed
        </p>
        <h1 className="mt-6 text-4xl md:text-6xl font-black uppercase tracking-tight text-white leading-[1.05]">
          The shinkansen
          <br />
          hit a snag
        </h1>
        <p className="mt-6 text-sm md:text-base leading-relaxed text-body-gray">
          An unexpected error stopped this page mid-journey. It is not your
          fault — the crew has been notified. Try again, or head back to the
          station.
        </p>
        {error.digest && (
          <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-white/30">
            ref: {error.digest}
          </p>
        )}

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            onClick={reset}
            className="inline-flex items-center gap-3 bg-flame px-8 py-4 text-[11px] font-black uppercase tracking-[0.25em] text-white transition-all duration-300 hover:bg-[#e65100] hover:shadow-[0_0_40px_rgba(255,87,34,0.45)]"
          >
            <RotateCcw className="h-4 w-4" />
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-3 px-8 py-4 text-[11px] font-black uppercase tracking-[0.25em] text-white/80 border border-white/25 hover:border-flame hover:text-white transition-all duration-300"
          >
            <Home className="h-4 w-4" />
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
