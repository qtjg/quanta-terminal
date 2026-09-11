import { NextRequest, NextResponse } from "next/server";
import { extractId, fetchTweetCore } from "@/lib/rizz-fetch";

/*
 * /api/rizz/fetch — keyless tweet fetch by link or bare status ID.
 * POST { url: "https://x.com/user/status/123" | "123" }
 * -> { ok: true, id, text, author, url, source, replyingTo, replyingToStatus }
 *
 * v0.8.0 FETCH+RT PACK: "fetch other tweet" for Android/panel — paste a
 * tweet LINK and the real tweet text lands in the input (no clipboard
 * gymnastics).
 *
 * v0.9.0 THREAD PACK: response now also carries the parent pointer
 * (replyingTo handle + replyingToStatus ID, null on standalone tweets)
 * so clients can offer thread-aware replies via /api/rizz/thread.
 *
 * Scope note: this fetches ONE public tweet on demand. Timelines/search
 * need the user's own X API keys (see /api/rizz/retweet) — never faked.
 *
 * CORS open (*) like the rest of the RizzReply API — personal build,
 * no auth by design; the APK WebView + PWA + extension share it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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
  const data = await fetchTweetCore(id);
  if (!data) {
    return NextResponse.json(
      {
        error:
          "Couldn't fetch that tweet (deleted, protected, or upstreams down) — copy-paste the text instead",
      },
      { status: 502, headers: CORS }
    );
  }
  return NextResponse.json(
    {
      ok: true,
      id,
      text: data.text,
      author: data.author,
      url: data.url,
      source: data.source,
      replyingTo: data.replyingTo ?? null,
      replyingToStatus: data.replyingToStatus ?? null,
    },
    { headers: CORS }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
