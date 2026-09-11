"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { rizzFetchResilient } from "@/lib/rizz-resilient";

/*
 * RizzReply — personal X copilot (web panel).
 * Works standalone on Android ("Add to Home screen" → real PWA install) and
 * as the fallback UI on PC. The Chrome extension uses /api/rizz directly.
 *
 * v0.6.0 — SMART PACK: GenZ + Pro tones, length dial, 🧠 bio memory
 * (truthful first-person), per-variant re-roll (↻), 🕘 history (last 15,
 * copyable), auto language match (server-side), PWA manifest + service
 * worker for home-screen install.
 * v0.7.0 — AUTOPILOT PACK: 🎲 Auto tone (the Brain picks the best tone),
 * changeable 🤖 agent mission (6 presets + custom, saved on device) and a
 * ⚡ Full auto run (auto tone + mission → generate → auto-copy #1).
 * v0.8.0 — FETCH+RT PACK: 🔗 fetch any tweet by LINK (keyless), the
 * clipboard auto-fetch now detects tweet links too, and 🔁 Retweet-source
 * via the user's own free X API keys (OAuth 1.0a, keys stay on device).
 * v0.10.0 — ⭐ REPLY VAULT: star any reply (results, history, batch) and
 * it's pinned in the Vault forever (cap 50) — history forgets, the Vault
 * doesn't. Copy again anytime. Same vault on PC extension (device-local).
 */

type Mode = "reply" | "quote" | "hook";
type Tone =
  | "auto"
  | "witty"
  | "expert"
  | "hype"
  | "friendly"
  | "savage"
  | "genz"
  | "professional";
type Length = "short" | "normal" | "detailed";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "reply", label: "Reply", hint: "Reply to someone else's tweet" },
  { id: "quote", label: "Quote", hint: "Add a caption on a quote-tweet" },
  { id: "hook", label: "Hook", hint: "Punch up my own draft" },
];

const TONES: { id: Tone; label: string; emoji: string }[] = [
  { id: "auto", label: "Auto", emoji: "🎲" },
  { id: "witty", label: "Witty", emoji: "😏" },
  { id: "expert", label: "Expert", emoji: "🧠" },
  { id: "hype", label: "Hype", emoji: "🔥" },
  { id: "friendly", label: "Friendly", emoji: "🤝" },
  { id: "savage", label: "Savage", emoji: "😈" },
  { id: "genz", label: "GenZ", emoji: "🧢" },
  { id: "professional", label: "Pro", emoji: "💼" },
];

const LENGTHS: { id: Length; label: string; emoji: string }[] = [
  { id: "short", label: "One-liner", emoji: "⚡" },
  { id: "normal", label: "Normal", emoji: "💬" },
  { id: "detailed", label: "Detailed", emoji: "📝" },
];

const SAMPLE =
  "just shipped my first side project after 3 weeks of building. it barely works but it works.";

const BIO_KEY = "rizzBio";
const HISTORY_KEY = "rizzHistory";
const TWEET_META_KEY = "rizzTweetMeta";
const VOICE_KEY = "rizzVoice"; // v0.9.0 — user's kept replies (voice memory)
const VAULT_KEY = "rizzVault"; // v0.10.0 — ⭐ pinned keeper replies
const VAULT_MAX = 50;
const TWEET_URL_RE =
  /(?:x\.com|twitter\.com)\/[A-Za-z0-9_]{1,15}\/status(?:es)?\/(\d{1,25})/i;

/* Android bridge exposed by the APK WebView (v1.2 clipboard, v1.3 openExternal) */
type RizzAndroidBridge = {
  getClipboard: () => string;
  lastAuto: () => string;
  markAuto: (s: string) => void;
  toast: (m: string) => void;
  openExternal: (tryUrl: string, fallbackUrl: string) => void;
};
function rizzBridge(): RizzAndroidBridge | undefined {
  return (window as unknown as { RizzAndroid?: RizzAndroidBridge }).RizzAndroid;
}
const AGENT_ID_KEY = "rizzAgentId";
const AGENT_CUSTOM_KEY = "rizzAgentCustom";
const XKEYS_KEY = "rizzXKeys";
const HISTORY_MAX = 15;

/* 🤖 agent missions — same menu as the extension (v0.7.0). "reply" = the
 * classic behavior, no directive sent. Others ship an AGENT DIRECTIVE. */
type AgentId =
  | "reply"
  | "question"
  | "value"
  | "funny"
  | "hype"
  | "disagree"
  | "custom";

const AGENT_PRESETS: {
  id: Exclude<AgentId, "custom">;
  chip: string;
  label: string;
  directive: string;
}[] = [
  { id: "reply", chip: "💬 Reply", label: "reply to this tweet", directive: "" },
  {
    id: "question",
    chip: "❓ Question",
    label: "ask a smart question",
    directive:
      "Lead with or include ONE smart, specific question about the tweet that moves the conversation forward",
  },
  {
    id: "value",
    chip: "💡 Add value",
    label: "add value + tip",
    directive:
      "Add real value: one concrete tip, insight, resource idea or sharp observation related to the tweet's topic",
  },
  {
    id: "funny",
    chip: "😂 Funny",
    label: "be funny",
    directive:
      "Be genuinely funny: one clever joke or witty observation grounded in the tweet's actual content — humor first, still relevant",
  },
  {
    id: "hype",
    chip: "🔥 Hype",
    label: "hype them up",
    directive:
      "Hype the author up: high-energy support that celebrates the SPECIFIC thing they shared — never generic praise",
  },
  {
    id: "disagree",
    chip: "🤨 Pushback",
    label: "respectful pushback",
    directive:
      "Give a respectful counter-angle or polite disagreement: bold, specific, classy — never rude, never a strawman",
  },
];

function agentDirectiveOf(id: AgentId, custom: string): string {
  if (id === "custom") return custom.trim().slice(0, 200);
  return AGENT_PRESETS.find((p) => p.id === id)?.directive || "";
}

function agentShortLabel(id: AgentId, custom: string): string {
  if (id === "custom") {
    const t = custom.trim();
    return t ? (t.length > 26 ? `${t.slice(0, 26)}…` : t) : "custom mission";
  }
  return AGENT_PRESETS.find((p) => p.id === id)?.label || "reply to this tweet";
}

/* Fetched-tweet context (v0.8.0) — powers 🔗 fetched chip + 🔁/💬 actions */
type TweetMeta = { id: string; url: string; author: string };

type HistEntry = {
  ts: number;
  mode: Mode;
  tone: Tone;
  tweet: string;
  variants: string[];
};

/* 🔑 X API keys (v0.8.0) — retweets are real write actions, so they run
 * through the user's OWN free keys. Stored in localStorage on this device
 * only; sent solely to /api/rizz/retweet to sign the call server-side. */
type XKeys = {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
};

const EMPTY_XKEYS: XKeys = {
  apiKey: "",
  apiSecret: "",
  accessToken: "",
  accessSecret: "",
};

const XKEY_FIELDS: { key: keyof XKeys; label: string; ph: string }[] = [
  { key: "apiKey", label: "API Key", ph: "API key (consumer key)" },
  { key: "apiSecret", label: "API Key Secret", ph: "API key secret (consumer secret)" },
  { key: "accessToken", label: "Access Token", ph: "access token" },
  { key: "accessSecret", label: "Access Token Secret", ph: "access token secret" },
];

const STATUS_URL_RE =
  /(?:x\.com|twitter\.com)\/[A-Za-z0-9_]{1,15}\/status(?:es)?\/\d{1,25}/i;

export default function RizzPage() {
  const [tweet, setTweet] = useState("");
  const [mode, setMode] = useState<Mode>("reply");
  const [tone, setTone] = useState<Tone>("witty");
  const [length, setLength] = useState<Length>("normal");
  const [bio, setBio] = useState("");
  const [bioOpen, setBioOpen] = useState(false);
  const [bioSaved, setBioSaved] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentId, setAgentId] = useState<AgentId>("reply");
  const [agentCustom, setAgentCustom] = useState("");
  // v0.8.0 — fetch + retweet (state: tweetMeta/fetching are the single source
  // of truth; X-key drawer + retweet status ride on top)
  const [xOpen, setXOpen] = useState(false);
  const [xKeys, setXKeys] = useState<XKeys>(EMPTY_XKEYS);
  const [xSaved, setXSaved] = useState(false);
  const [rtDoing, setRtDoing] = useState(false);
  const [rtDone, setRtDone] = useState(false);
  const [rtMsg, setRtMsg] = useState("");
  const [autoCopied, setAutoCopied] = useState(false);
  const [history, setHistory] = useState<HistEntry[]>([]);
  const [histOpen, setHistOpen] = useState(false);
  const [variants, setVariants] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [rerolling, setRerolling] = useState<number | null>(null);
  // v0.9.0 AUTONOMY PACK — the brain's smart next-move suggestion
  const [nextMove, setNextMove] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [tweetMeta, setTweetMeta] = useState<TweetMeta | null>(null);
  const [fetching, setFetching] = useState(false);
  // v0.9.0 THREAD PACK — keyless conversation context for the current tweet
  const [threadCtx, setThreadCtx] = useState<
    { author: string; text: string }[]
  >([]);
  // v0.9.0 VOICE MEMORY — how many of the user's own replies we remember
  const [voiceN, setVoiceN] = useState(0);
  // v0.10.0 ⭐ VAULT — pinned keeper replies (never auto-evicted)
  const [vault, setVault] = useState<{ text: string; ts: number }[]>([]);
  const [vaultOpen, setVaultOpen] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  // 🔗 FETCH-TWEET (v0.8.0): paste a tweet LINK → real text lands in the box.
  const fetchTweet = useCallback(async (raw: string, viaAuto = false) => {
    const t = raw.trim();
    const m = t.match(TWEET_URL_RE);
    const id = m ? m[1] : /^\d{1,25}$/.test(t) ? t : null;
    if (!id) return false;
    setFetching(true);
    try {
      const r = await fetch("/api/rizz/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: id }),
      });
      const d = (await r.json()) as {
        ok?: boolean;
        text?: string;
        author?: string;
        url?: string;
        error?: string;
      };
      if (d && d.ok && d.text) {
        setTweet(d.text.slice(0, 1200));
        const meta: TweetMeta = {
          id,
          url: d.url || `https://x.com/i/web/status/${id}`,
          author: d.author || "",
        };
        setTweetMeta(meta);
        try {
          window.localStorage.setItem(TWEET_META_KEY, JSON.stringify(meta));
        } catch {
          /* storage unavailable — chip lives for this session only */
        }
        rizzBridge()?.toast("Tweet fetched ✓");
        setError(null);
        // 🧵 THREAD PACK (v0.9.0): pull the conversation context silently —
        // non-blocking, never blocks the fetched text from being usable.
        fetch("/api/rizz/thread", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: id }),
        })
          .then((r) => r.json())
          .then((td: { ok?: boolean; chain?: { author?: string; text?: string }[] }) => {
            if (td && td.ok && Array.isArray(td.chain)) {
              // drop the target itself (last item) — server re-checks anyway
              const parents = td.chain
                .slice(0, -1)
                .map((c) => ({
                  author: String(c.author || ""),
                  text: String(c.text || ""),
                }))
                .filter((c) => c.text);
              setThreadCtx(parents.slice(-2));
            } else {
              setThreadCtx([]);
            }
          })
          .catch(() => setThreadCtx([]));
        return true;
      }
      if (!viaAuto)
        setError(
          d?.error || "Couldn't fetch that tweet — copy-paste the text instead"
        );
      return false;
    } catch {
      if (!viaAuto) setError("Fetch failed — network hiccup, try again");
      return false;
    } finally {
      setFetching(false);
    }
  }, []);

  // 🧠 VOICE MEMORY (v0.9.0): every reply you keep (copy / auto-copy) is
  // remembered on this device — the Brain matches YOUR voice next time.
  const rememberVoice = useCallback((text: string) => {
    const v = text.trim();
    if (!v) return;
    try {
      const raw = window.localStorage.getItem(VOICE_KEY);
      const list: string[] = raw ? JSON.parse(raw) : [];
      const next = [...list.filter((s) => s !== v), v].slice(-30);
      window.localStorage.setItem(VOICE_KEY, JSON.stringify(next));
      setVoiceN(next.length);
    } catch {
      /* storage unavailable — voice memory stays off */
    }
  }, []);
  const voiceStyle = useCallback((): string => {
    try {
      const raw = window.localStorage.getItem(VOICE_KEY);
      const list: string[] = raw ? JSON.parse(raw) : [];
      // last 4 samples, de-noised — loose guidance, hard-capped server-side
      return list
        .slice(-4)
        .join("\n")
        .slice(0, 700);
    } catch {
      return "";
    }
  }, []);
  const clearVoice = useCallback(() => {
    try {
      window.localStorage.removeItem(VOICE_KEY);
    } catch {
      /* ignore */
    }
    setVoiceN(0);
  }, []);

  // ⭐ VAULT (v0.10.0): pin keeper replies — history evicts at 15, the
  // vault keeps what YOU star until you remove it (cap 50, this device).
  const starVariant = useCallback((text: string) => {
    const v = text.trim();
    if (!v) return;
    let on = false;
    setVault((prev) => {
      const exists = prev.some((e) => e.text === v);
      on = !exists;
      const next = exists
        ? prev.filter((e) => e.text !== v)
        : [{ text: v, ts: Date.now() }, ...prev].slice(0, VAULT_MAX);
      try {
        window.localStorage.setItem(VAULT_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable — vault lives for this session only */
      }
      return next;
    });
    return on;
  }, []);
  const removeVault = useCallback((ts: number) => {
    setVault((prev) => {
      const next = prev.filter((e) => e.ts !== ts);
      try {
        window.localStorage.setItem(VAULT_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const clearVault = useCallback(() => {
    try {
      window.localStorage.removeItem(VAULT_KEY);
    } catch {
      /* ignore */
    }
    setVault([]);
  }, []);
  const isStarred = useCallback(
    (text: string) => vault.some((e) => e.text === text.trim()),
    [vault]
  );

  // 🔁 RETWEET (v0.8.0): hand the tweet to the X app — one tap on 🔁 there.
  const openRetweet = useCallback(() => {
    if (!tweetMeta) return;
    const br = rizzBridge();
    if (br?.openExternal) {
      br.openExternal(
        `twitter://status?tweet_id=${tweetMeta.id}`,
        tweetMeta.url
      );
      return;
    }
    window.open(tweetMeta.url, "_blank", "noopener");
  }, [tweetMeta]);

  // 💬 QUOTE (v0.8.0): X composer pre-filled with the reply + tweet link.
  const quoteVariant = useCallback(
    (text: string) => {
      if (!tweetMeta) return;
      const q = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
        text.trim().slice(0, 275)
      )}&url=${encodeURIComponent(`https://x.com/i/status/${tweetMeta.id}`)}`;
      const br = rizzBridge();
      if (br?.openExternal) {
        br.openExternal(q, q);
        return;
      }
      window.open(q, "_blank", "noopener");
    },
    [tweetMeta]
  );

  // Load the saved bio + history once (client only — SSR safe)
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(BIO_KEY);
      if (saved && saved.trim()) {
        setBio(saved.trim().slice(0, 300));
        setBioSaved(true);
      }
      const savedAgentId = window.localStorage.getItem(AGENT_ID_KEY);
      if (savedAgentId) setAgentId(savedAgentId as AgentId);
      // v0.9.0 — show how many voice samples we already remember
      try {
        const rawVoice = window.localStorage.getItem(VOICE_KEY);
        const list: string[] = rawVoice ? JSON.parse(rawVoice) : [];
        if (Array.isArray(list)) setVoiceN(list.length);
      } catch {
        /* ignore */
      }
      // v0.10.0 — load the ⭐ vault
      try {
        const rawVault = window.localStorage.getItem(VAULT_KEY);
        const pv: { text: string; ts: number }[] = rawVault
          ? JSON.parse(rawVault)
          : [];
        if (Array.isArray(pv)) setVault(pv.slice(0, VAULT_MAX));
      } catch {
        /* ignore */
      }
      const savedAgentCustom = window.localStorage.getItem(AGENT_CUSTOM_KEY);
      if (savedAgentCustom !== null) setAgentCustom(savedAgentCustom.slice(0, 200));
      const rawHist = window.localStorage.getItem(HISTORY_KEY);
      if (rawHist) {
        const parsed = JSON.parse(rawHist) as HistEntry[];
        if (Array.isArray(parsed)) setHistory(parsed.slice(0, HISTORY_MAX));
      }
      const rawMeta = window.localStorage.getItem(TWEET_META_KEY);
      if (rawMeta) {
        const pm = JSON.parse(rawMeta) as TweetMeta;
        if (pm && pm.id && pm.url) setTweetMeta(pm);
      }
      const rawKeys = window.localStorage.getItem(XKEYS_KEY);
      if (rawKeys) {
        try {
          const parsedKeys = JSON.parse(rawKeys) as Partial<XKeys>;
          const merged: XKeys = { ...EMPTY_XKEYS, ...parsedKeys };
          setXKeys(merged);
          if (merged.apiKey && merged.apiSecret && merged.accessToken && merged.accessSecret) {
            setXSaved(true);
          }
        } catch {
          /* malformed keys — ignore, defaults stand */
        }
      }
    } catch {
      /* storage unavailable — defaults stand */
    }
    // Android share sheet (PWA share_target): /rizz?text=...&url=...
    // Pre-fill the tweet box from the shared content, then clean the URL.
    try {
      const sp = new URLSearchParams(window.location.search);
      const sharedText = (sp.get("text") || sp.get("title") || "").trim();
      const sharedUrl = (sp.get("url") || "").trim();
      let pre = sharedText;
      if (pre && sharedUrl && !pre.includes(sharedUrl)) {
        pre = `${pre}\n${sharedUrl}`;
      } else if (!pre && sharedUrl) {
        pre = sharedUrl;
      }
      if (pre) {
        // v0.8.0: shared a bare tweet LINK → fetch the real tweet text
        if (pre.length < 220 && STATUS_URL_RE.test(pre)) {
          fetchTweet(pre);
        } else {
          setTweet(pre.slice(0, 1200));
        }
        window.history.replaceState({}, "", "/rizz");
      }
    } catch {
      /* no shared text — start empty */
    }
    // Android floating-app share bridge: the native APK evaluates
    // window.__rizzPrefill(text) after a share-intent lands in it.
    (window as unknown as { __rizzPrefill?: (t: string) => void }).__rizzPrefill = (
      t: string
    ) => {
      if (t && t.trim()) setTweet(t.trim().slice(0, 1200));
    };
    // Android floating-app AUTO-FETCH bridge (APK v1.2+): the native side
    // pings window.__rizzAutoFetch() when the bubble panel / fullscreen app
    // opens and we pull the copied tweet straight off the clipboard — no
    // manual paste. Deduped via RizzBridge.lastAuto/markAuto.
    const aw = window as unknown as {
      __rizzAutoFetch?: () => void;
      RizzAndroid?: {
        getClipboard: () => string;
        lastAuto: () => string;
        markAuto: (s: string) => void;
        toast: (m: string) => void;
      };
    };
    aw.__rizzAutoFetch = () => {
      try {
        const br = aw.RizzAndroid;
        if (!br || typeof br.getClipboard !== "function") return;
        const text = String(br.getClipboard() || "").trim();
        const last = String(br.lastAuto() || "");
        if (text.length >= 12 && text !== last) {
          // v0.8.0: a tweet LINK on the clipboard → fetch the real tweet
          if (STATUS_URL_RE.test(text)) {
            br.markAuto(text);
            fetchTweet(text);
            br.toast("Fetching tweet from link…");
            return;
          }
          // plain tweet text on the clipboard → land it in the input
          br.markAuto(text);
          setTweet(text.slice(0, 1200));
          br.toast("Auto-fetched from clipboard ✓");
          return;
        }
        if (last) {
          // clipboard unchanged/empty → restore last fetch if input is empty
          setTweet((prev) =>
            prev && prev.trim() ? prev : last.slice(0, 1200)
          );
        }
      } catch {
        /* clipboard blocked — manual paste still works */
      }
    };
    // page loaded straight into a just-opened panel → fetch right now
    if (aw.RizzAndroid) aw.__rizzAutoFetch();
    // PWA: register the passthrough service worker (enables home-screen app)
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/rizz/sw.js").catch(() => {});
    }
  }, []);

  const saveHistory = useCallback((next: HistEntry[]) => {
    const capped = next.slice(0, HISTORY_MAX);
    setHistory(capped);
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(capped));
    } catch {
      /* ignore */
    }
  }, []);

  const updateLastHistory = useCallback(
    (idx: number, text: string) => {
      setHistory((prev) => {
        if (!prev.length || !Array.isArray(prev[0].variants)) return prev;
        const entry = { ...prev[0], variants: prev[0].variants.slice() };
        entry.variants[idx] = text;
        const next = [entry, ...prev.slice(1)];
        try {
          window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    []
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    try {
      window.localStorage.removeItem(HISTORY_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const saveBio = useCallback(() => {
    const clean = bio.trim().slice(0, 300);
    try {
      if (clean) {
        window.localStorage.setItem(BIO_KEY, clean);
      } else {
        window.localStorage.removeItem(BIO_KEY);
      }
    } catch {
      /* ignore */
    }
    setBio(clean);
    setBioSaved(!!clean);
    setBioOpen(false);
  }, [bio]);

  const saveAgentMission = useCallback(
    (id: AgentId, custom: string) => {
      const clean = custom.trim().slice(0, 200);
      let finalId = id;
      if (finalId !== "custom" && clean) finalId = "custom"; // typed text wins
      if (finalId === "custom" && !clean) finalId = "reply"; // empty custom = none
      setAgentId(finalId);
      setAgentCustom(clean);
      try {
        if (finalId === "custom") {
          window.localStorage.setItem(AGENT_ID_KEY, finalId);
          window.localStorage.setItem(AGENT_CUSTOM_KEY, clean);
        } else {
          window.localStorage.setItem(AGENT_ID_KEY, finalId);
          window.localStorage.removeItem(AGENT_CUSTOM_KEY);
        }
      } catch {
        /* ignore */
      }
      setAgentOpen(false);
    },
    []
  );

  const runGenerate = useCallback(
    async (opts?: { toneOverride?: Tone }) => {
      const text = tweet.trim();
      if (!text) {
        setError("Paste a tweet first ✍️");
        return;
      }
      const toneUsed = opts?.toneOverride || tone;
      const directive = agentDirectiveOf(agentId, agentCustom);
      setLoading(true);
      setError(null);
      setVariants([]);
      setNextMove("");
      try {
        // v0.10.1 UNLIMITED — auto-resumes through upstream quota windows
        const { res, data } = await rizzFetchResilient(
          {
            tweet: text,
            mode,
            tone: toneUsed,
            length,
            bio: bioSaved ? bio : "",
            agent: directive,
            thread: threadCtx, // v0.9.0 thread context (may be empty)
            style: voiceStyle(), // v0.9.0 voice memory
          },
          (n, max, s) =>
            setError(`AI quota busy — resuming ${n}/${max} in ${s}s…`)
        );
        if (!res.ok || !data.variants) {
          throw new Error(data.error || `Request failed (${res.status})`);
        }
        setVariants(data.variants);
        setNextMove(String(data.nextMove || ""));
        // ⚡ full-auto run: put variant 1 on the clipboard (best effort —
        // the regular Copy buttons remain the fallback)
        if (autoCopyRef.current && data.variants.length) {
          autoCopyRef.current = false;
          rememberVoice(data.variants[0]); // 🧠 voice memory (before clipboard — intent is what counts)
          try {
            await navigator.clipboard.writeText(data.variants[0]);
            setAutoCopied(true);
            setTimeout(() => setAutoCopied(false), 2600);
          } catch {
            /* clipboard refused — Copy buttons are right there */
          }
        }
        // 🕘 remember this batch (most recent first, capped at 15)
        saveHistory([
          {
            ts: Date.now(),
            mode,
            tone: toneUsed,
            tweet: text.slice(0, 90),
            variants: data.variants.slice(),
          },
          ...history,
        ]);
        setTimeout(
          () =>
            resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
          80
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    },
    [tweet, mode, tone, length, bio, bioSaved, agentId, agentCustom, history, saveHistory, threadCtx, voiceStyle, rememberVoice]
  );

  const generate = useCallback(() => runGenerate(), [runGenerate]);

  // ⚡ Full auto — 🎲 auto tone + saved mission, then auto-copy #1 so the
  // reply is one paste away (PWA can't type into the X app directly).
  const autoCopyRef = useRef(false);
  const fullAuto = useCallback(async () => {
    autoCopyRef.current = true;
    await runGenerate({ toneOverride: "auto" });
  }, [runGenerate]);

  // 🔑 persist X API keys on this device (retweet needs them for one-tap)
  const saveXKeys = useCallback((k: XKeys) => {
    const clean: XKeys = {
      apiKey: k.apiKey.trim(),
      apiSecret: k.apiSecret.trim(),
      accessToken: k.accessToken.trim(),
      accessSecret: k.accessSecret.trim(),
    };
    setXKeys(clean);
    const full = !!(
      clean.apiKey &&
      clean.apiSecret &&
      clean.accessToken &&
      clean.accessSecret
    );
    setXSaved(full);
    try {
      if (full) {
        window.localStorage.setItem(XKEYS_KEY, JSON.stringify(clean));
      } else {
        window.localStorage.removeItem(XKEYS_KEY);
      }
    } catch {
      /* ignore */
    }
    setXOpen(false);
  }, []);

  // 🔁 RETWEET (v0.8.0, two tiers):
  //   keys in 🔑 drawer → REAL retweet via X API (OAuth 1.0a, server signs)
  //   no keys          → deeplink hand-off to the X app (one native tap)
  const retweetSource = useCallback(async () => {
    if (!tweetMeta || rtDoing) return;
    const haveKeys = !!(
      xKeys.apiKey &&
      xKeys.apiSecret &&
      xKeys.accessToken &&
      xKeys.accessSecret
    );
    setRtDoing(true);
    setRtMsg("");
    setRtDone(false);
    try {
      const res = await fetch("/api/rizz/retweet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          haveKeys
            ? { id: tweetMeta.id, ...xKeys }
            : { id: tweetMeta.id, mode: "rt" }
        ),
      });
      const d = (await res.json()) as {
        ok?: boolean;
        via?: string;
        already?: boolean;
        deeplink?: string;
        fallback?: string;
        error?: string;
      };
      if (!res.ok || !d.ok) {
        throw new Error(d.error || `Retweet failed (${res.status})`);
      }
      if (d.via === "deeplink") {
        const br = rizzBridge();
        if (br?.openExternal && d.deeplink) {
          br.openExternal(d.deeplink, d.fallback || tweetMeta.url);
        } else {
          window.open(d.fallback || tweetMeta.url, "_blank", "noopener");
        }
        setRtMsg(
          "Opened X — tap 🔁 there to finish. (Add 🔑 API keys for one-tap retweet)"
        );
        return;
      }
      setRtDone(true);
      setRtMsg(
        d.already
          ? "Already retweeted ✓"
          : `Retweeted ✓${tweetMeta.author ? ` ${tweetMeta.author}` : ""}`
      );
    } catch (e) {
      setRtMsg(e instanceof Error ? e.message : "Retweet failed");
    } finally {
      setRtDoing(false);
    }
  }, [tweetMeta, rtDoing, xKeys]);

  // ↻ Re-roll — fresh replacement for just THIS variant (count: 1)
  const reroll = useCallback(
    async (i: number) => {
      if (rerolling !== null || loading) return;
      const text = tweet.trim();
      if (!text) return;
      setRerolling(i);
      setError(null);
      try {
        // v0.10.1 UNLIMITED — re-roll auto-resumes through quota windows
        const { res, data } = await rizzFetchResilient(
          {
            tweet: text,
            mode,
            tone,
            length,
            bio: bioSaved ? bio : "",
            agent: agentDirectiveOf(agentId, agentCustom),
            count: 1,
            thread: threadCtx, // v0.9.0 thread context
            style: voiceStyle(), // v0.9.0 voice memory
          },
          (n, max, s) =>
            setError(`AI quota busy — resuming ${n}/${max} in ${s}s…`)
        );
        if (!res.ok || !data.variants || !data.variants.length) {
          throw new Error(data.error || `Request failed (${res.status})`);
        }
        const nv = data.variants[0];
        setVariants((prev) => {
          const next = prev.slice();
          next[i] = nv;
          return next;
        });
        if (data.nextMove) setNextMove(data.nextMove); // fresh next-move too
        updateLastHistory(i, nv); // keep history consistent with the card
      } catch (e) {
        setError(e instanceof Error ? e.message : "Re-roll failed");
      } finally {
        setRerolling(null);
      }
    },
    [tweet, mode, tone, length, bio, bioSaved, agentId, agentCustom, rerolling, loading, updateLastHistory, threadCtx, voiceStyle]
  );

  const copy = useCallback(
    async (i: number, text: string) => {
    // 🧠 intent to keep = memory, regardless of whether the clipboard API
    // cooperates (headless/permission-restricted contexts reject it)
    rememberVoice(text);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Copy failed — select the text manually");
    }
    },
    [rememberVoice]
  );

  const charCount = tweet.trim().length;

  return (
    <main className="flex-1 w-full bg-[#0D0F12] text-zinc-100">
      <div className="mx-auto w-full max-w-xl px-4 pb-16 pt-8 sm:pt-12">
        {/* Header */}
        <header className="mb-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400 text-xl text-black shadow-lg shadow-amber-400/20">
              ✨
            </span>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">
                Rizz<span className="text-amber-400">Reply</span>
              </h1>
              <p className="text-sm text-zinc-400">
                Your personal X copilot — never post a boring reply again
              </p>
            </div>
          </div>
        </header>

        {/* Mode tabs */}
        <div
          className="mb-3 grid grid-cols-3 gap-2"
          role="tablist"
          aria-label="Generation mode"
        >
          {MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              title={m.hint}
              onClick={() => setMode(m.id)}
              className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all ${
                mode === m.id
                  ? "border-amber-400 bg-amber-400 text-black"
                  : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Tweet input */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <label htmlFor="tweet-input" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {mode === "hook" ? "Your draft" : "The tweet you're replying to"}
          </label>
          <textarea
            id="tweet-input"
            value={tweet}
            onChange={(e) => setTweet(e.target.value.slice(0, 1200))}
            placeholder={
              mode === "hook"
                ? "Paste your draft tweet here..."
                : "Paste the tweet text here (any language — the reply matches it automatically)..."
            }
            rows={5}
            className="w-full resize-none rounded-xl border border-zinc-800 bg-[#0D0F12] p-3 text-[15px] leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <button
                onClick={() => setTweet(SAMPLE)}
                className="rounded-lg px-2 py-1 font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-amber-400"
              >
                Try sample
              </button>
              <button
                onClick={() => fetchTweet(tweet)}
                disabled={fetching}
                title="Paste a tweet LINK in the box, then tap this — the real tweet text lands here"
                className="rounded-lg px-2 py-1 font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {fetching ? "Fetching…" : "🔗 Fetch by link"}
              </button>
              <a
                href="/rizz/batch"
                title="Batch mode — paste up to 10 tweet links, generate replies for all"
                className="rounded-lg px-2 py-1 font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-amber-400"
              >
                ⚡ Batch
              </a>
            </span>
            <span className={charCount > 1200 ? "text-red-400" : ""}>{charCount}/1200</span>
          </div>
        </div>

        {/* 🔗 fetched source + 🔁 retweet + 💬 quote (v0.8.0) */}
        {tweetMeta && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-zinc-300">
                Fetched source{" "}
                {tweetMeta.author && (
                  <span className="text-amber-400">{tweetMeta.author}</span>
                )}
                {threadCtx.length > 0 && (
                  <span
                    title="Conversation context fetched — replies now know the whole thread"
                    className="ml-2 rounded-full bg-sky-400/15 px-2 py-0.5 text-[10px] font-bold text-sky-400"
                  >
                    🧵 +{threadCtx.length} context
                  </span>
                )}
              </p>
              <a
                href={tweetMeta.url}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-[11px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
              >
                {tweetMeta.url}
              </a>
            </div>
            <span className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => quoteVariant(variants[0] || "")}
                disabled={!variants.length}
                title="Quote-tweet with your top variant"
                className="rounded-xl border border-zinc-700 px-3.5 py-2 text-xs font-bold text-zinc-200 transition-colors hover:border-sky-400 hover:text-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                💬 Quote
              </button>
              <button
                onClick={retweetSource}
                disabled={rtDoing}
                title="Retweet: with 🔑 keys = one tap via X API, without = opens X"
                className={`rounded-xl border px-3.5 py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  rtDone
                    ? "border-green-500 bg-green-500/10 text-green-400"
                    : "border-zinc-700 text-zinc-200 hover:border-pink-400 hover:text-pink-400"
                }`}
              >
                {rtDoing ? "🔁…" : rtDone ? "✓ Retweeted" : "🔁 Retweet"}
              </button>
            </span>
          </div>
        )}
        {rtMsg && (
          <p
            role="status"
            className={`mt-2 rounded-xl border px-3 py-2 text-xs ${
              rtDone
                ? "border-green-900/60 bg-green-950/40 text-green-300"
                : "border-red-900/60 bg-red-950/40 text-red-300"
            }`}
          >
            {rtMsg}
          </p>
        )}

        {/* 🧠 Voice memory chip (v0.9.0) — appears once you keep replies */}
        {voiceN > 0 && (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2">
            <span className="text-xs text-zinc-400">
              🧠 Voice memory: <span className="font-bold text-amber-400">{voiceN}</span> of your replies remembered — new ones sound like you
            </span>
            <button
              onClick={clearVoice}
              title="Forget all remembered replies"
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-red-400"
            >
              Clear
            </button>
          </div>
        )}

        {/* Bio memory */}
        <div className="mt-4">
          <button
            onClick={() => setBioOpen((v) => !v)}
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:text-amber-400"
            aria-expanded={bioOpen}
          >
            🧠 My bio {bioSaved && <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-400">saved ✓</span>}
            <span className="ml-auto">{bioOpen ? "▲" : "▼"}</span>
          </button>
          {bioOpen && (
            <div className="mt-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="mb-2 text-xs leading-relaxed text-zinc-500">
                What do you actually build? Saved on this device only. The Brain may
                use it in first person — replies stay truthful, never invented.
              </p>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, 300))}
                rows={2}
                maxLength={300}
                placeholder="e.g. building a fitness app for busy devs"
                className="w-full resize-none rounded-xl border border-zinc-800 bg-[#0D0F12] p-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-zinc-600">{bio.length}/300</span>
                <button
                  onClick={saveBio}
                  className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-black transition-colors hover:bg-amber-300"
                >
                  Save bio
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 🤖 Auto-write mission — changeable agent directive (v0.7.0) */}
        <div className="mt-4">
          <button
            onClick={() => setAgentOpen((v) => !v)}
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:text-amber-400"
            aria-expanded={agentOpen}
          >
            🤖 Auto-write mission
            <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-400 normal-case">
              {agentShortLabel(agentId, agentCustom)}
            </span>
            <span className="ml-auto">{agentOpen ? "▲" : "▼"}</span>
          </button>
          {agentOpen && (
            <div className="mt-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="mb-2 text-xs leading-relaxed text-zinc-500">
                What should the agent DO? Pick a preset or write your own — it
                drives ⚡ Full auto and every generate.
              </p>
              <div className="flex flex-wrap gap-2">
                {AGENT_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setAgentId(p.id)}
                    aria-pressed={agentId === p.id}
                    title={p.label}
                    className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all ${
                      agentId === p.id
                        ? "border-amber-400 bg-amber-400/10 text-amber-400"
                        : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-600"
                    }`}
                  >
                    {p.chip}
                  </button>
                ))}
                <button
                  onClick={() => setAgentId("custom")}
                  aria-pressed={agentId === "custom"}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    agentId === "custom"
                      ? "border-amber-400 bg-amber-400/10 text-amber-400"
                      : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-600"
                  }`}
                >
                  ✍️ Custom
                </button>
              </div>
              <textarea
                value={agentCustom}
                onChange={(e) => {
                  setAgentCustom(e.target.value.slice(0, 200));
                  setAgentId("custom");
                }}
                rows={2}
                maxLength={200}
                placeholder="Or your own mission: e.g. ask about their pricing model"
                className="mt-2 w-full resize-none rounded-xl border border-zinc-800 bg-[#0D0F12] p-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-zinc-600">{agentCustom.length}/200</span>
                <button
                  onClick={() => saveAgentMission(agentId, agentCustom)}
                  className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-black transition-colors hover:bg-amber-300"
                >
                  Save mission
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 🔑 X API — keys for the retweet action (v0.8.0) */}
        <div className="mt-4">
          <button
            onClick={() => setXOpen((v) => !v)}
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:text-amber-400"
            aria-expanded={xOpen}
          >
            🔑 X API (retweet)
            {xSaved && (
              <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-400">saved ✓</span>
            )}
            <span className="ml-auto">{xOpen ? "▲" : "▼"}</span>
          </button>
          {xOpen && (
            <div className="mt-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="mb-2 text-xs leading-relaxed text-zinc-500">
                Retweets are real write actions on your account, so they run
                through <b>your own free X API keys</b>: developer.x.com →
                Project → App → <b>Keys &amp; tokens</b> → regenerate the user
                Access Token &amp; Secret. They stay in this browser and are
                only used to sign your retweet call — never stored on the
                server, never logged.
              </p>
              {XKEY_FIELDS.map((f) => (
                <div key={f.key} className="mb-2">
                  <label
                    htmlFor={`xkey-${f.key}`}
                    className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500"
                  >
                    {f.label}
                  </label>
                  <input
                    id={`xkey-${f.key}`}
                    type="password"
                    value={xKeys[f.key]}
                    onChange={(e) =>
                      setXKeys((prev) => ({
                        ...prev,
                        [f.key]: e.target.value.slice(0, 200),
                      }))
                    }
                    placeholder={f.ph}
                    autoComplete="off"
                    className="w-full rounded-xl border border-zinc-800 bg-[#0D0F12] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                  />
                </div>
              ))}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => saveXKeys(EMPTY_XKEYS)}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-400 transition-colors hover:border-red-400 hover:text-red-400"
                >
                  Clear keys
                </button>
                <button
                  onClick={() => saveXKeys(xKeys)}
                  className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-black transition-colors hover:bg-amber-300"
                >
                  Save keys
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 🕘 History — last 15 generations, copyable */}
        <div className="mt-4">
          <button
            onClick={() => setHistOpen((v) => !v)}
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:text-amber-400"
            aria-expanded={histOpen}
          >
            🕘 History{history.length > 0 && (
              <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                {history.length}
              </span>
            )}
            <span className="ml-auto">{histOpen ? "▲" : "▼"}</span>
          </button>
          {histOpen && (
            <div className="mt-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                  Recent generations
                </p>
                {history.length > 0 && (
                  <button
                    onClick={clearHistory}
                    className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-400 transition-colors hover:border-amber-400 hover:text-amber-400"
                  >
                    Clear
                  </button>
                )}
              </div>
              {history.length === 0 ? (
                <p className="text-xs text-zinc-600">
                  Nothing yet — every generation lands here.
                </p>
              ) : (
                <div className="space-y-3">
                  {history.map((h, hi) => (
                    <div
                      key={`${h.ts}-${hi}`}
                      className="rounded-xl border border-zinc-800 bg-[#0D0F12] p-3"
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        {h.mode} · {h.tone} ·{" "}
                        {new Date(h.ts).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-600" title={h.tweet}>
                        {h.tweet}
                      </p>
                      <div className="mt-2 space-y-1.5">
                        {(h.variants || []).map((v, vi) => (
                          <div key={vi} className="flex items-start justify-between gap-2">
                            <span className="line-clamp-2 text-[13px] leading-snug text-zinc-300">
                              {v}
                            </span>
                            <span className="flex shrink-0 items-center gap-1.5">
                              <button
                                onClick={() => starVariant(v)}
                                title={
                                  isStarred(v)
                                    ? "In your Vault — tap to remove"
                                    : "Star it — rescue this into your Vault"
                                }
                                className={`rounded-lg px-2 py-1 text-xs font-bold transition-colors ${
                                  isStarred(v)
                                    ? "text-amber-400"
                                    : "text-zinc-500 hover:bg-zinc-800 hover:text-amber-400"
                                }`}
                              >
                                {isStarred(v) ? "⭐" : "☆"}
                              </button>
                              <button
                                onClick={() => copy(-1 - hi * 100 - vi, v)}
                                className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                                  copied === -1 - hi * 100 - vi
                                    ? "bg-green-500 text-black"
                                    : "bg-zinc-800 text-zinc-300 hover:bg-amber-400 hover:text-black"
                                }`}
                              >
                                {copied === -1 - hi * 100 - vi ? "✓" : "Copy"}
                              </button>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ⭐ Vault — pinned keepers (v0.10.0) */}
        <div className="mt-4">
          <button
            onClick={() => setVaultOpen((v) => !v)}
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:text-amber-400"
            aria-expanded={vaultOpen}
          >
            ⭐ Vault{vault.length > 0 && (
              <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                {vault.length}
              </span>
            )}
            <span className="ml-auto">{vaultOpen ? "▲" : "▼"}</span>
          </button>
          {vaultOpen && (
            <div className="mt-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                  Your keeper replies
                </p>
                {vault.length > 0 && (
                  <button
                    onClick={clearVault}
                    className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-400 transition-colors hover:border-red-400 hover:text-red-400"
                  >
                    Clear
                  </button>
                )}
              </div>
              {vault.length === 0 ? (
                <p className="text-xs text-zinc-600">
                  No stars yet — tap ⭐ on any reply you&apos;d reuse. History
                  forgets, the Vault doesn&apos;t.
                </p>
              ) : (
                <div className="space-y-2">
                  {vault.map((e) => (
                    <div
                      key={e.ts}
                      className="flex items-start justify-between gap-2 rounded-xl border border-zinc-800 bg-[#0D0F12] p-3"
                    >
                      <span className="line-clamp-3 text-[13px] leading-snug text-zinc-200">
                        {e.text}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <button
                          onClick={() => copy(-2 - e.ts, e.text)}
                          className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                            copied === -2 - e.ts
                              ? "bg-green-500 text-black"
                              : "bg-zinc-800 text-zinc-300 hover:bg-amber-400 hover:text-black"
                          }`}
                        >
                          {copied === -2 - e.ts ? "✓" : "Copy"}
                        </button>
                        <button
                          onClick={() => removeVault(e.ts)}
                          title="Remove from Vault"
                          className="rounded-lg px-2 py-1 text-xs font-bold text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-red-400"
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Tone pills */}
        <div className="mt-4" role="group" aria-label="Tone">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Tone
          </p>
          <div className="flex flex-wrap gap-2">
            {TONES.map((t) => (
              <button
                key={t.id}
                onClick={() => setTone(t.id)}
                aria-pressed={tone === t.id}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition-all ${
                  tone === t.id
                    ? "border-amber-400 bg-amber-400/10 text-amber-400"
                    : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-600"
                }`}
              >
                <span aria-hidden="true">{t.emoji}</span> {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Length pills */}
        <div className="mt-4" role="group" aria-label="Length">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Length
          </p>
          <div className="flex flex-wrap gap-2">
            {LENGTHS.map((l) => (
              <button
                key={l.id}
                onClick={() => setLength(l.id)}
                aria-pressed={length === l.id}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition-all ${
                  length === l.id
                    ? "border-amber-400 bg-amber-400/10 text-amber-400"
                    : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-600"
                }`}
              >
                <span aria-hidden="true">{l.emoji}</span> {l.label}
              </button>
            ))}
          </div>
        </div>

        {/* Generate */}
        <button
          onClick={fullAuto}
          disabled={loading}
          className="mt-5 w-full rounded-2xl border-2 border-amber-400 bg-transparent py-3.5 text-base font-extrabold text-amber-400 transition-all hover:bg-amber-400/10 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "🤖 Full auto: tone 🎲 + writing…" : `⚡ Full auto — 🤖 ${agentShortLabel(agentId, agentCustom)}`}
        </button>
        <button
          onClick={generate}
          disabled={loading}
          className="mt-2 w-full rounded-2xl bg-amber-400 py-4 text-base font-extrabold text-black transition-all hover:bg-amber-300 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />
              Cooking rizz...
            </span>
          ) : (
            "✨ Generate 3 options"
          )}
        </button>

        {/* Error */}
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300"
          >
            {error}
          </p>
        )}

        {/* ⚡ full-auto bonus: variant 1 already on the clipboard */}
        {autoCopied && (
          <p className="mt-4 rounded-xl border border-green-900/60 bg-green-950/40 px-4 py-3 text-sm text-green-300">
            ⚡ Variant 1 copied ✓ — go paste it in your reply. Different vibe? Copy #2 or #3 below.
          </p>
        )}

        {/* Results */}
        <div ref={resultsRef} className="mt-6 space-y-3">
          {nextMove && !loading && (
            <div className="flex items-start gap-2 rounded-2xl border border-sky-500/30 bg-sky-500/5 px-4 py-3 text-xs text-sky-300">
              <span className="shrink-0 font-bold">👉 Next move</span>
              <span>{nextMove}</span>
            </div>
          )}
          {variants.map((v, i) => (
            <article
              key={`${i}-${v.slice(0, 12)}`}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 transition-colors hover:border-zinc-700"
            >
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-100">
                {v}
              </p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-zinc-500">
                  {v.length} chars {v.length > 280 ? "⚠️ over 280" : "✓ fits X"}
                </span>
                <span className="flex items-center gap-2">
                  <button
                    onClick={() => reroll(i)}
                    disabled={rerolling !== null}
                    title="Re-roll just this one"
                    className={`rounded-xl border border-zinc-700 px-3 py-2 text-sm font-bold text-zinc-300 transition-colors hover:border-amber-400 hover:bg-amber-400 hover:text-black disabled:cursor-not-allowed disabled:opacity-50 ${
                      rerolling === i ? "animate-pulse" : ""
                    }`}
                  >
                    {rerolling === i ? "…" : "↻"}
                  </button>
                  <button
                    onClick={() => starVariant(v)}
                    title={
                      isStarred(v)
                        ? "In your Vault — tap to remove"
                        : "Star it — save to your Vault"
                    }
                    aria-pressed={isStarred(v)}
                    className={`rounded-xl border px-3 py-2 text-sm font-bold transition-colors ${
                      isStarred(v)
                        ? "border-amber-400 bg-amber-400/10 text-amber-400"
                        : "border-zinc-700 text-zinc-400 hover:border-amber-400 hover:text-amber-400"
                    }`}
                  >
                    {isStarred(v) ? "⭐" : "☆"}
                  </button>
                  <button
                    onClick={() => copy(i, v)}
                    className={`rounded-xl px-4 py-2 text-sm font-bold transition-colors ${
                      copied === i
                        ? "bg-green-500 text-black"
                        : "bg-zinc-800 text-zinc-200 hover:bg-amber-400 hover:text-black"
                    }`}
                  >
                    {copied === i ? "Copied ✓" : "Copy"}
                  </button>
                </span>
              </div>
            </article>
          ))}
        </div>

        {/* Install guide */}
        <section className="mt-12 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wider text-zinc-400">
            📱 Install it
          </h2>
          <div className="space-y-4 text-sm leading-relaxed text-zinc-300">
            <div>
              <p className="font-bold text-zinc-100">
                Android — floating bubble app v1.2, over ANY app 🫧:
              </p>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-zinc-400">
                <li>
                  Download{" "}
                  <a
                    href="/rizz/RizzReply.apk"
                    className="font-semibold text-amber-400 underline decoration-amber-400/40 underline-offset-2 hover:decoration-amber-400"
                  >
                    RizzReply.apk
                  </a>{" "}
                  on your phone (v1.2 — updates over v1.0/v1.1, same signature)
                </li>
                <li>
                  Open it → allow <b>install unknown apps</b> when asked (personal
                  build, not on Play Store)
                </li>
                <li>
                  Open RizzReply → grant <b>Display over other apps</b> → done: the
                  ✨ bubble floats over the X app itself
                </li>
                <li>
                  Tap the bubble → the copied tweet <b>auto-fills</b> (v1.2
                  auto-fetch — a tweet LINK gets fetched too 🔗) → ⚡ Full auto
                  → paste your reply. Fetched a tweet? <b>🔁 Retweet</b> it via
                  your X API keys (🔑 drawer).
                  <b> Long-press</b> the bubble → fullscreen app
                </li>
                <li>
                  New ⚙ settings: <b>bubble ON/OFF</b>, size (S/M/L), remember
                  position, haptics, <b>start on boot</b>, tall panel. Also in the
                  notification: <b>Settings</b> / <b>Turn off</b>
                </li>
              </ol>
            </div>
            <div>
              <p className="font-bold text-zinc-100">Android — home-screen web app (no APK):</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-zinc-400">
                <li>Open this page in Chrome on your phone</li>
                <li>
                  Menu (⋮) → <b>Add to Home screen</b> → it installs like a real app 🚀
                </li>
                <li>
                  <b>Re-add it once</b> after this update to unlock the share sheet:
                  in X, tap <b>Share</b> on any tweet → <b>RizzReply</b> → the tweet
                  lands here pre-filled → generate → copy back. Fastest flow yet ⚡
                </li>
              </ol>
            </div>
            <div>
              <p className="font-bold text-zinc-100">
                Android — the bubble INSIDE x.com (advanced):
              </p>
              <p className="mt-1 text-zinc-400">
                The X app is native, so Chrome extensions can&apos;t run inside it. If
                you browse <b>x.com in a mobile browser</b> instead: install{" "}
                <b>Kiwi Browser</b> → download{" "}
                <a
                  href="/rizz-extension.zip"
                  className="font-semibold text-amber-400 underline decoration-amber-400/40 underline-offset-2 hover:decoration-amber-400"
                >
                  rizz-extension.zip
                </a>{" "}
                → Kiwi → ⋮ → Extensions → Developer mode → Load from ZIP. Same ✨
                bubble as on PC.
              </p>
            </div>
            <div>
              <p className="font-bold text-zinc-100">PC — Chrome extension (floating bubble on x.com):</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-zinc-400">
                <li>
                  Download{" "}
                  <a
                    href="/rizz-extension.zip"
                    className="font-semibold text-amber-400 underline decoration-amber-400/40 underline-offset-2 hover:decoration-amber-400"
                  >
                    rizz-extension.zip
                  </a>{" "}
                  and unzip it
                </li>
                <li>
                  Chrome → <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs">chrome://extensions</code> →
                  enable <b>Developer mode</b> (top right)
                </li>
                <li>
                  Click <b>Load unpacked</b> → select the unzipped folder
                </li>
                <li>
                  Open <b>x.com</b> → hover any tweet → click the <b>✨</b> bubble bottom-right 🚀
                </li>
              </ol>
            </div>
            <p className="rounded-xl bg-zinc-800/60 px-3 py-2 text-xs text-zinc-500">
              Personal build v0.10.0 — copilot, not autopilot. Fetch 🔗 · reply
              ✨ · batch ⚡ · retweet 🔁 · vault ⭐ — you press every button
              that touches your account.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
