import { NextRequest, NextResponse } from "next/server";

/*
 * /api/rizz/thread — v0.9.0 AUTONOMY PACK, feature #1 THREAD-AWARE.
 * POST { url: "https://x.com/user/status/123" | "123" }
 * -> { ok: true, id, chain: [{ id, text, author, url }...] (oldest first,
 *      ends with the TARGET tweet), depth }
 *
 * Walks UP the reply chain via fxtwitter's `replying_to_status` field —
 * keyless, same trust tier as /api/rizz/fetch. Defensive by design:
 *   - only fxtwitter exposes parent IDs (syndication/oEmbed do not)
 *   - parent fetch failure → chain stops there, never fabricates
 *   - no reply fields → chain = [target] alone (current behavior)
 * The Brain uses the chain as CONVERSATION CONTEXT; earlier tweets are
 * background, the LAST chain entry is the tweet being replied to.
 * Max depth 4 — real reply chains rarely go deeper and latency matters.
 *
 * CORS open (*) like the rest of the RizzReply API — personal build.
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
const MAX_DEPTH = 4;

function extractId(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  const m = s.match(STATUS_RE);
  if (m) return m[1];
  if (BARE_ID_RE.test(s)) return s;
  const loose = s.match(/\/status(?:es)?\/(\d{1,25})/i);
  return loose ? loose[1] : null;
}

type FxNode = {
  tweet?: {
    id?: string;
    text?: string;
    url?: string;
    author?: { screen_name?: string };
    replying_to_status?: string | null;
  };
};

async function fxNode(id: string): Promise<FxNode["tweet"] | null> {
  try {
    const res = await fetch(`https://api.fxtwitter.com/status/${id}`, {
      signal: AbortSignal.timeout(9000),
      headers: { "user-agent": "RizzReply/0.9 (+personal-build)" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as FxNode;
    const t = j?.tweet;
    if (!t || !String(t.text || "").trim()) return null;
    return t;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  let raw = "";
  try {
    const body = (await req.json()) as { url?: string };
    raw = String(body?.url || "");
  } catch {
    return NextResponse.json(
      { error: "Send JSON { url }" },
      { status: 400, headers: CORS }
    );
  }
  const id = extractId(raw);
  if (!id) {
    return NextResponse.json(
      {
        error:
          "That doesn't look like a tweet link — paste something like https://x.com/user/status/123…",
      },
      { status: 400, headers: CORS }
    );
  }

  // Walk UP the chain: target first, then parents, capped at MAX_DEPTH.
  const up: { id: string; text: string; author: string; url: string }[] = [];
  let cursor: string | null = id;
  let depth = 0;
  while (cursor && depth < MAX_DEPTH) {
    const node = await fxNode(cursor);
    if (!node) break;
    up.push({
      id: String(node.id || cursor),
      text: String(node.text || "").slice(0, 600),
      author: node.author?.screen_name ? `@${node.author.screen_name}` : "",
      url: String(node.url || `https://x.com/i/status/${cursor}`),
    });
    const parent =
      node.replying_to_status && /^\d{1,25}$/.test(String(node.replying_to_status))
        ? String(node.replying_to_status)
        : null;
    cursor = parent;
    depth += 1;
  }

  // Loop guard: dedupe by id (a bad upstream cycle must not hang us)
  const seen = new Set<string>();
  const chain: { id: string; text: string; author: string; url: string }[] = [];
  for (let i = up.length - 1; i >= 0; i--) {
    const n = up[i];
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    chain.push(n);
  }

  return NextResponse.json(
    { ok: true, id, chain, depth: chain.length - 1 },
    { headers: CORS }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
