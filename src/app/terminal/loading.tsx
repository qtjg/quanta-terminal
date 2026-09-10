export default function TerminalLoading() {
  /* QUANTA-scoped loading screen — dark boot prompt for
     navigation into /terminal. */
  return (
    <div
      className="min-h-screen bg-[#0a0c0f] flex items-center justify-center font-mono"
      role="status"
      aria-label="Loading terminal"
    >
      <div className="text-[13px] leading-relaxed text-[#33E1AA]">
        <p>
          <span className="text-white/40">quanta os 0.5.0 —</span> mounting
          vfs…
        </p>
        <p className="mt-1 animate-pulse">▮ booting terminal…</p>
      </div>
    </div>
  );
}
