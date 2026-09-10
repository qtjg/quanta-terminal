export default function NotFound() {
  return (
    <main className="min-h-screen bg-[#0d0f12] text-[#e8e6e3] font-mono flex flex-col items-center justify-center gap-4 px-6">
      <p className="text-[#FF5722] text-sm">quanta-sh: 404 — command not found</p>
      <h1 className="text-4xl font-bold tracking-tight">This route does not exist</h1>
      <p className="text-white/60 text-sm max-w-md text-center">
        The path you typed is not part of the filesystem. Try &lsquo;help&rsquo; inside the terminal.
      </p>
      <a
        href="/terminal"
        className="mt-2 inline-flex items-center gap-2 rounded-md border border-[#FF5722]/40 bg-[#FF5722]/10 px-4 py-2 text-sm text-[#FF5722] hover:bg-[#FF5722]/20 transition-colors"
      >
        $ cd /terminal
      </a>
    </main>
  );
}
