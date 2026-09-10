export default function Loading() {
  return (
    <div
      className="min-h-screen bg-[#0d0f12] flex items-center justify-center"
      role="status"
      aria-label="Loading"
    >
      <div className="font-mono text-sm text-[#FF5722] animate-pulse">
        booting quanta-sh…
      </div>
    </div>
  );
}
