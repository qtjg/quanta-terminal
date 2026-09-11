"use client";

import { useCallback, useRef, useState } from "react";

/*
 * /rizz/batch — v0.9.0 BATCH QUEUE (one of the autonomy-tier-1 pack).
 * Paste up to 10 tweet LINKS (one per line) → the agent fetches each one
 * keylessly, pulls its thread context, generates 3 replies per tweet with
 * 🎲 auto tone, and lays them out as cards. You tap the variant you want →
 * it lands on your clipboard (and feeds voice memory) → paste-post it in X.
 * Human stays the poster: the agent stages everything, you fire.
 *
 * Runs inside the APK bubble WebView, the fullscreen PWA, and any desktop
 * browser — same live server brain as the single-tweet page.
 */

const VOICE_KEY = "rizzVoice";
const MAX_ITEMS = 10;

const TWEET_URL_RE =
  /(?:x\.com|twitter\.com)\/[A-Za-z0-9_]{1,15}\/status(?:es)?\/(\d{1,25})/i;

type BatchItem = {
  raw: string;
  status: "queued" | "fetching" | "generating" | "done" | "error";
  tweet?: string;
  author?: string;
  threadDepth?: number;
  variants?: string[];
  nextMove?: string;
  error?: string;
};

export default function BatchPage() {
  const [raw, setRaw] = useState("");
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const validCount = lines.filter((l) =>
    TWEET_URL_RE.test(l) || /^\d{1,25}$/.test(l)
  ).length;

  const rememberVoice = useCallback((text: string) => {
    const v = text.trim();
    if (!v) return;
    try {
      const r = window.localStorage.getItem(VOICE_KEY);
      const list: string[] = r ? JSON.parse(r) : [];
      const next = [...list.filter((s) => s !== v), v].slice(-30);
      window.localStorage.setItem(VOICE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const updateItem = useCallback((i: number, patch: Partial<BatchItem>) => {
    setItems((prev) => {
      const next = prev.slice();
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }, []);

  /* One item = fetch → thread → generate. Extracted so a single failed
   * item can be retried on its own (↻) without re-running the whole queue. */
  const runItem = useCallback(
    async (i: number, rawItem: string) => {
      updateItem(i, { status: "fetching", error: undefined });
      try {
        // 1) resolve + fetch the tweet (also normalizes plain text input)
        const m = rawItem.match(TWEET_URL_RE);
        const id = m ? m[1] : /^\d{1,25}$/.test(rawItem) ? rawItem : "";
        let tweetText = "";
        let author = "";
        let threadCtx: { author: string; text: string }[] = [];

        if (id) {
          const fr = await fetch("/api/rizz/fetch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: id }),
          });
          const fd = (await fr.json()) as {
            ok?: boolean;
            text?: string;
            author?: string;
            error?: string;
          };
          if (!fr.ok || !fd.ok || !fd.text) {
            throw new Error(fd.error || `Fetch failed (${fr.status})`);
          }
          tweetText = fd.text.slice(0, 1200);
          author = fd.author || "";

          // 2) thread context — silent best effort
          try {
            const tr = await fetch("/api/rizz/thread", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: id }),
            });
            const td = (await tr.json()) as {
              ok?: boolean;
              chain?: { author?: string; text?: string }[];
            };
            if (td && td.ok && Array.isArray(td.chain)) {
              threadCtx = td.chain
                .slice(0, -1)
                .map((c) => ({
                  author: String(c.author || ""),
                  text: String(c.text || ""),
                }))
                .filter((c) => c.text)
                .slice(-2);
            }
          } catch {
            /* no context — single-tweet mode */
          }
        } else {
          tweetText = rawItem.slice(0, 1200); // plain pasted text
        }

        updateItem(i, { status: "generating", tweet: tweetText, author, threadDepth: threadCtx.length });

        // 3) generate with 🎲 auto tone + thread + voice memory
        let style = "";
        try {
          const rv = window.localStorage.getItem(VOICE_KEY);
          const list: string[] = rv ? JSON.parse(rv) : [];
          style = list.slice(-4).join("\n").slice(0, 700);
        } catch {
          /* ignore */
        }
        const gr = await fetch("/api/rizz", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tweet: tweetText,
            mode: "reply",
            tone: "auto",
            length: "normal",
            author,
            thread: threadCtx,
            style,
          }),
        });
        const gd = (await gr.json()) as {
          variants?: string[];
          nextMove?: string;
          error?: string;
        };
        if (!gr.ok || !gd.variants) {
          throw new Error(gd.error || `Generation failed (${gr.status})`);
        }
        updateItem(i, {
          status: "done",
          variants: gd.variants,
          nextMove: String(gd.nextMove || ""),
        });
      } catch (e) {
        updateItem(i, {
          status: "error",
          error: e instanceof Error ? e.message : "Failed",
        });
      }
    },
    [updateItem]
  );

  const run = useCallback(async () => {
    const targets = lines
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, MAX_ITEMS);
    if (!targets.length || running) return;
    cancelRef.current = false;
    setRunning(true);
    setItems(targets.map((t) => ({ raw: t, status: "queued" })));

    for (let i = 0; i < targets.length; i++) {
      if (cancelRef.current) break;
      await runItem(i, targets[i]);
    }
    setRunning(false);
  }, [lines, running, runItem]);

  // ↻ Retry just ONE failed item (no full re-run). Also used as the ↻
  // regenerate on done cards. Running-guard keeps it from racing the
  // main queue loop or another single-item retry.
  const retryItem = useCallback(
    async (i: number) => {
      const it = items[i];
      if (
        !it ||
        running ||
        it.status === "fetching" ||
        it.status === "generating"
      )
        return;
      cancelRef.current = false;
      setRunning(true);
      await runItem(i, it.raw);
      setRunning(false);
    },
    [items, running, runItem]
  );

  const copyVariant = useCallback(
    async (key: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        rememberVoice(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 1500);
      } catch {
        /* clipboard refused */
      }
    },
    [rememberVoice]
  );

  const doneN = items.filter((it) => it.status === "done" || it.status === "error").length;

  return (
    <main className="flex-1 w-full bg-[#0D0F12] text-zinc-100">
      <div className="mx-auto w-full max-w-xl px-4 pb-16 pt-8 sm:pt-12">
        <header className="mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400 text-xl text-black shadow-lg shadow-amber-400/20">
                ⚡
              </span>
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight">
                  Batch <span className="text-amber-400">queue</span>
                </h1>
                <p className="text-sm text-zinc-400">
                  Paste tweet links — get replies for all, one tap each
                </p>
              </div>
            </div>
            <a
              href="/rizz"
              className="rounded-xl border border-zinc-700 px-3 py-2 text-xs font-bold text-zinc-300 transition-colors hover:border-amber-400 hover:text-amber-400"
            >
              ← Single
            </a>
          </div>
        </header>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <label
            htmlFor="batch-input"
            className="mb-2 block text-xs font-semibold uppercase tracking-wider text-zinc-500"
          >
            Tweet links (one per line, max {MAX_ITEMS}) — or plain tweet text
          </label>
          <textarea
            id="batch-input"
            value={raw}
            onChange={(e) => setRaw(e.target.value.slice(0, 4000))}
            rows={5}
            placeholder={
              "https://x.com/user/status/123…\nhttps://x.com/user/status/456…\n…"
            }
            className="w-full resize-none rounded-xl border border-zinc-800 bg-[#0D0F12] p-3 text-[15px] leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
            <span>
              {validCount > 0
                ? `${validCount} link${validCount > 1 ? "s" : ""} detected`
                : "paste links — 🎲 auto tone + 🧵 thread context + 🧠 voice memory applied"}
            </span>
            <button
              onClick={running ? () => (cancelRef.current = true) : run}
              disabled={!running && validCount === 0 && lines.length === 0}
              className={`rounded-xl px-4 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                running
                  ? "bg-zinc-700 text-zinc-200 hover:bg-zinc-600"
                  : "bg-amber-400 text-black hover:bg-amber-300"
              }`}
            >
              {running ? `Stop (${doneN}/${items.length})` : `⚡ Generate all${validCount ? ` (${Math.min(validCount, MAX_ITEMS)})` : ""}`}
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="mt-4 space-y-4">
          {items.map((it, i) => (
            <div
              key={`${it.raw}-${i}`}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4"
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <p className="line-clamp-2 flex-1 text-xs text-zinc-500">
                  <span className="mr-2 font-bold text-zinc-400">
                    #{i + 1}{" "}
                    {it.status === "fetching" && "· fetching…"}
                    {it.status === "generating" && "· thinking…"}
                    {it.status === "error" && "· failed"}
                    {it.author && <span className="text-amber-400">{it.author}</span>}
                    {!!it.threadDepth && (
                      <span className="ml-2 rounded-full bg-sky-400/15 px-2 py-0.5 text-[10px] font-bold text-sky-400">
                        🧵 +{it.threadDepth}
                      </span>
                    )}
                  </span>
                  {it.tweet || it.raw}
                </p>
                {it.status === "done" && (
                  <button
                    onClick={() => retryItem(i)}
                    disabled={running}
                    title="Regenerate this one"
                    className="shrink-0 rounded-lg border border-zinc-700 px-2 py-1 text-[11px] font-bold text-zinc-400 transition-colors hover:border-amber-400 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ↻
                  </button>
                )}
              </div>
              {it.status === "error" && (
                <p className="flex items-center justify-between gap-2 rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                  <span>{it.error}</span>
                  <button
                    onClick={() => retryItem(i)}
                    title="Retry just this one"
                    className="shrink-0 rounded-lg border border-red-800 px-2.5 py-1 font-bold text-red-200 transition-colors hover:border-amber-400 hover:text-amber-400"
                  >
                    ↻ Retry
                  </button>
                </p>
              )}
              {it.status === "done" && it.nextMove && (
                <p className="mb-2 flex items-start gap-2 rounded-xl border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-[11px] text-sky-300">
                  <span className="shrink-0 font-bold">👉 Next move</span>
                  <span>{it.nextMove}</span>
                </p>
              )}
              {it.status === "done" && it.variants && (
                <div className="space-y-2">
                  {it.variants.map((v, k) => {
                    const key = `${i}-${k}`;
                    return (
                      <button
                        key={key}
                        onClick={() => copyVariant(key, v)}
                        className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm leading-relaxed transition-colors ${
                          copied === key
                            ? "border-green-500 bg-green-500/10 text-green-300"
                            : "border-zinc-800 bg-[#0D0F12] text-zinc-100 hover:border-amber-400"
                        }`}
                      >
                        {v}
                        <span className="mt-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                          {copied === key ? "copied ✓ — paste it in X" : "tap to copy"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {items.length > 0 && !running && (
          <p className="mt-4 text-center text-xs text-zinc-600">
            Kept replies feed 🧠 voice memory — the more you use it, the more
            it sounds like you.
          </p>
        )}
      </div>
    </main>
  );
}
