import Link from "next/link";

export const metadata = {
  title: "404 — quanta: no such file or directory",
  robots: { index: false, follow: false },
};

export default function TerminalNotFound() {
  /* QUANTA-scoped 404 — the root 404 must not render on /terminal/* */
  return (
    <div className="min-h-screen bg-[#0a0c0f] flex items-center justify-center font-mono px-6">
      <div className="max-w-md w-full text-[13px] leading-relaxed">
        <p className="text-[#FF5722]">
          quanta: cd: /this/path: No such file or directory
        </p>
        <p className="mt-3 text-white/60">
          The path you requested does not exist in this filesystem.
        </p>
        <pre className="mt-4 text-white/40 text-[12px]">{`$ suggestions
  /          → open the terminal
  cd /       → go home`}</pre>
        <Link
          href="/terminal"
          className="mt-5 inline-block border border-[#33E1AA]/40 text-[#33E1AA] px-4 py-2 rounded-sm hover:bg-[#33E1AA]/10 transition-colors"
        >
          cd /terminal
        </Link>
      </div>
    </div>
  );
}
