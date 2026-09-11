import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/*
 * /api/rizz/retweet — retweet / quote dispatcher (v0.8.0 FETCH+RT PACK).
 *
 * TWO TIERS, one endpoint (merged from both build passes):
 *
 * TIER 1 — REAL retweet (needs the user's OWN X API keys in the body):
 *   POST { id | url, mode?: "rt", apiKey, apiSecret, accessToken, accessSecret }
 *   → OAuth 1.0a user context: GET /2/users/me, then
 *     POST /2/users/:uid/retweets/:tweet_id → { ok, via: "api", retweeted }
 *   Keys are NEVER stored server-side and NEVER logged — they sign the two
 *   calls and are discarded. Free X API tier includes a small write quota;
 *   retweets count as posts. "already retweeted" reports ok + already.
 *
 * TIER 2 — ASSISTED (no keys): the honest fallback. X requires OAuth user
 *   context for writes, so without keys we hand the tweet to the X app via
 *   deep link (twitter://) — one native tap on 🔁, zero ban-risk automation.
 *   POST { id | url, mode: "rt" }  → { ok, via: "deeplink", deeplink, fallback }
 *   POST { id | url, mode: "quote", text? } → pre-filled quote composer intent
 *   The APK v1.3 bridge (window.RizzAndroid.openExternal) launches these;
 *   the PWA falls back to window.open.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const STATUS_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/[A-Za-z0-9_]{1,15}\/status(?:es)?\/(\d{1,25})/i;
const BARE_ID_RE = /^\d{1,25}$/;

function extractId(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  const m = s.match(STATUS_RE);
  if (m) return m[1];
  if (BARE_ID_RE.test(s)) return s;
  const loose = s.match(/\/status(?:es)?\/(\d{1,25})/i);
  return loose ? loose[1] : null;
}

type XKeys = {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
};

function hasKeys(k: XKeys): boolean {
  return !!(k.apiKey && k.apiSecret && k.accessToken && k.accessSecret);
}

function pct(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/** RFC 5849 §3.4 — HMAC-SHA1 signature over method&url&sorted-params. */
function oauthHeader(method: string, url: string, k: XKeys): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: k.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: k.accessToken,
    oauth_version: "1.0",
  };
  const params = Object.keys(oauth)
    .sort()
    .map((p) => `${pct(p)}=${pct(oauth[p])}`)
    .join("&");
  const baseStr = [method.toUpperCase(), pct(url), pct(params)].join("&");
  const signKey = `${pct(k.apiSecret)}&${pct(k.accessSecret)}`;
  const sig = crypto
    .createHmac("sha1", signKey)
    .update(baseStr)
    .digest("base64");
  oauth.oauth_signature = sig;
  const pairs = Object.keys(oauth)
    .sort()
    .map((p) => `${pct(p)}="${pct(oauth[p])}"`)
    .join(", ");
  return `OAuth ${pairs}`;
}

type XJson = {
  data?: { id?: string; username?: string; retweeted?: boolean };
  errors?: { message?: string; code?: number }[];
  detail?: string;
  title?: string;
};

async function xFetch(
  method: "GET" | "POST",
  url: string,
  k: XKeys
): Promise<{ status: number; json: XJson | null }> {
  const res = await fetch(url, {
    method,
    headers: { authorization: oauthHeader(method, url, k) },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  let json: XJson | null = null;
  try {
    json = (await res.json()) as XJson;
  } catch {
    /* non-JSON (html error page) — fall through with null */
  }
  return { status: res.status, json };
}

function friendlyError(status: number, j: XJson | null): string {
  const upstream = j?.errors?.[0]?.message || j?.detail || j?.title || "";
  if (status === 401)
    return "X rejected the keys (401) — double-check all 4 fields and that the access token belongs to this app's key/secret";
  if (status === 403)
    return "X refused the retweet (403) — your X API tier needs Write access, or the tweet is protected/deleted";
  if (status === 429)
    return "X rate limit (429) — your API tier's post quota is used up, try later";
  return `X API error ${status}${upstream ? `: ${upstream}` : ""}`;
}

export async function POST(req: NextRequest) {
  let body: (XKeys & { id?: string; url?: string; mode?: string; text?: string }) | null =
    null;
  try {
    body = (await req.json()) as XKeys & {
      id?: string;
      url?: string;
      mode?: string;
      text?: string;
    };
  } catch {
    return NextResponse.json(
      { ok: false, error: "Send JSON { id | url, mode?, text?, apiKey?… }" },
      { status: 400, headers: CORS }
    );
  }
  const id = extractId(String(body?.id || body?.url || ""));
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Need a tweet link or status id — fetch the tweet first" },
      { status: 400, headers: CORS }
    );
  }
  const mode = String(body?.mode || "rt").toLowerCase();
  if (mode !== "rt" && mode !== "quote") {
    return NextResponse.json(
      { ok: false, error: "mode must be 'rt' or 'quote'" },
      { status: 400, headers: CORS }
    );
  }

  const k: XKeys = {
    apiKey: String(body?.apiKey || "").trim(),
    apiSecret: String(body?.apiSecret || "").trim(),
    accessToken: String(body?.accessToken || "").trim(),
    accessSecret: String(body?.accessSecret || "").trim(),
  };

  /* ---- quote: composer intent (works with or without keys) ---- */
  if (mode === "quote") {
    const clean = String(body?.text || "").trim().slice(0, 275);
    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      clean
    )}&url=${encodeURIComponent(`https://x.com/i/status/${id}`)}`;
    return NextResponse.json(
      {
        ok: true,
        via: "deeplink",
        mode,
        deeplink: intent,
        fallback: intent,
        note: "Opens the X composer with your comment + the tweet linked — tap Post to quote-retweet.",
      },
      { headers: CORS }
    );
  }

  /* ---- rt tier 1: real retweet through the user's keys ---- */
  if (hasKeys(k)) {
    const me = await xFetch("GET", "https://api.x.com/2/users/me", k);
    if (me.status !== 200 || !me.json?.data?.id) {
      return NextResponse.json(
        { ok: false, error: friendlyError(me.status, me.json) },
        {
          status: me.status >= 400 && me.status < 500 ? me.status : 502,
          headers: CORS,
        }
      );
    }
    const uid = me.json.data.id;
    const username = me.json.data.username || "";
    const rt = await xFetch(
      "POST",
      `https://api.x.com/2/users/${uid}/retweets/${id}`,
      k
    );
    if (rt.status !== 200) {
      const msg = rt.json?.errors?.[0]?.message || "";
      if (/already/i.test(msg)) {
        return NextResponse.json(
          { ok: true, via: "api", already: true, id, user: username },
          { headers: CORS }
        );
      }
      return NextResponse.json(
        { ok: false, error: friendlyError(rt.status, rt.json) },
        {
          status: rt.status >= 400 && rt.status < 500 ? rt.status : 502,
          headers: CORS,
        }
      );
    }
    return NextResponse.json(
      { ok: true, via: "api", retweeted: true, id, user: username },
      { headers: CORS }
    );
  }

  /* ---- rt tier 2: no keys → assisted deeplink (honest, no silent write) ---- */
  return NextResponse.json(
    {
      ok: true,
      via: "deeplink",
      mode: "rt",
      deeplink: `twitter://status?tweet_id=${id}`,
      fallback: `https://x.com/i/web/status/${id}`,
      note: "Opens the tweet in X — one tap on 🔁 retweets it. Add your free X API keys (🔑 drawer) to upgrade this to a true one-tap retweet.",
    },
    { headers: CORS }
  );
}

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: "rizz-retweet-dispatcher",
      modes: ["rt", "quote"],
      tiers: {
        api: "POST with all 4 X API keys → real retweet (OAuth 1.0a)",
        deeplink: "POST without keys → twitter:// hand-off to the X app",
        quote: "POST mode=quote + text → pre-filled composer intent",
      },
      note: "Keys are never stored or logged — they only sign your call.",
    },
    { headers: CORS }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
