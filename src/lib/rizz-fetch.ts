/*
 * rizz-fetch — shared keyless tweet fetch core (v0.9.0 THREAD PACK).
 * Extracted from /api/rizz/fetch so /api/rizz/thread can walk a reply
 * chain with the exact same 3-tier upstream logic. Upstream chain, first
 * responder wins:
 *   1. api.fxtwitter.com    — clean JSON, no key, most reliable
 *   2. cdn.syndication      — X's own embed endpoint (react-tweet token)
 *   3. publish.twitter.com  — oEmbed blockquote, parsed
 *
 * v0.9.0: fxtwitter also exposes `replying_to` (parent handle) and
 * `replying_to_status` (parent status ID) — both null on standalone tweets.
 * The thread route follows that pointer to rebuild the conversation.
 */

export const STATUS_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/[A-Za-z0-9_]{1,15}\/status(?:es)?\/(\d{1,25})/i;
const BARE_ID_RE = /^\d{1,25}$/;

export function extractId(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  const m = s.match(STATUS_RE);
  if (m) return m[1];
  if (BARE_ID_RE.test(s)) return s;
  const loose = s.match(/\/status(?:es)?\/(\d{1,25})/i);
  return loose ? loose[1] : null;
}

export type Fetched = {
  text: string;
  author: string;
  url: string;
  source: string;
  replyingTo?: string | null;
  replyingToStatus?: string | null;
};

type FxRes = {
  tweet?: {
    text?: string;
    url?: string;
    author?: { screen_name?: string };
    replying_to?: string | null;
    replying_to_status?: string | null;
  };
};

async function fromFx(id: string): Promise<Fetched | null> {
  try {
    const res = await fetch(`https://api.fxtwitter.com/status/${id}`, {
      signal: AbortSignal.timeout(9000),
      headers: { "user-agent": "RizzReply/0.9 (+personal-build)" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as FxRes;
    const text = String(j?.tweet?.text || "").trim();
    if (!text) return null;
    return {
      text,
      author: j?.tweet?.author?.screen_name
        ? `@${j.tweet.author.screen_name}`
        : "",
      url: String(j?.tweet?.url || `https://x.com/i/status/${id}`),
      source: "fxtwitter",
      replyingTo: j?.tweet?.replying_to || null,
      replyingToStatus: j?.tweet?.replying_to_status || null,
    };
  } catch {
    return null;
  }
}

type SyndRes = { text?: string; user?: { screen_name?: string } };

async function fromSyndication(id: string): Promise<Fetched | null> {
  try {
    // react-tweet's token trick — covers most public tweets
    const token = ((Number(id) / 1e15) * Math.PI)
      .toString(36)
      .replace(/(0+|\.)/g, "");
    const res = await fetch(
      `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=en`,
      { signal: AbortSignal.timeout(9000), cache: "no-store" }
    );
    if (!res.ok) return null;
    const j = (await res.json()) as SyndRes;
    const text = String(j?.text || "").trim();
    if (!text) return null;
    return {
      text,
      author: j?.user?.screen_name ? `@${j.user.screen_name}` : "",
      url: `https://x.com/i/status/${id}`,
      source: "syndication",
      replyingTo: null,
      replyingToStatus: null,
    };
  } catch {
    return null;
  }
}

type OEmbedRes = { html?: string; author_name?: string };

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

async function fromOEmbed(id: string): Promise<Fetched | null> {
  try {
    const res = await fetch(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(
        `https://x.com/i/status/${id}`
      )}&omit_script=1&dnt=true&hide_thread=true`,
      { signal: AbortSignal.timeout(9000), cache: "no-store" }
    );
    if (!res.ok) return null;
    const j = (await res.json()) as OEmbedRes;
    const html = String(j?.html || "");
    const p = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (!p) return null;
    const text = decodeEntities(p[1].replace(/<[^>]+>/g, "")).trim();
    if (!text) return null;
    // footer: "— Display Name (@handle) Month…" → pull the handle
    const handle = html.match(/—\s*[^(@]+?\(@([A-Za-z0-9_]{1,15})\)/);
    return {
      text,
      author: handle ? `@${handle[1]}` : "",
      url: `https://x.com/i/status/${id}`,
      source: "oembed",
      replyingTo: null,
      replyingToStatus: null,
    };
  } catch {
    return null;
  }
}

export async function fetchTweetCore(id: string): Promise<Fetched | null> {
  return (
    (await fromFx(id)) || (await fromSyndication(id)) || (await fromOEmbed(id))
  );
}
