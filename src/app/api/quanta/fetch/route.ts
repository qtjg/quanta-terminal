import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface FetchBody {
  url?: string;
  maxChars?: number;
}

const BLOCKED_HOSTS = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[::1\])/i;

export async function POST(req: NextRequest) {
  let body: FetchBody;
  try {
    body = (await req.json()) as FetchBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const url = (body.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ ok: false, error: "url must start with http(s)://" }, { status: 400 });
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ ok: false, error: "malformed url" }, { status: 400 });
  }
  if (BLOCKED_HOSTS.test(parsed.hostname)) {
    return NextResponse.json({ ok: false, error: "blocked: internal/private addresses are not allowed" }, { status: 403 });
  }

  const maxChars = Math.min(Math.max(body.maxChars ?? 800, 100), 4000);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "QuantaTerminal/0.5 (+web sandbox)", accept: "*/*" },
    });
    const buf = await res.arrayBuffer();
    const timeMs = Date.now() - started;
    const head = new Uint8Array(buf.slice(0, maxChars * 4));
    const text = new TextDecoder("utf-8", { fatal: false }).decode(head).slice(0, maxChars);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return NextResponse.json({
      ok: true,
      status: res.status,
      statusText: res.statusText,
      headers,
      bodyHead: text,
      bytes: buf.byteLength,
      timeMs,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: msg.includes("abort") ? "timed out after 10s" : msg },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
