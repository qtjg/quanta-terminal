import { NextRequest, NextResponse } from "next/server";
import { callProvider, ChatMessage } from "@/lib/quanta-providers";

export const dynamic = "force-dynamic";

interface ChatBody {
  question?: string;
  /* multi-turn continuation: prior turns (already trimmed client-side) */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /* optional system override (summarize/translate/… commands) */
  system?: string;
  /* provider selection from `model use` */
  provider?: string;
  model?: string;
}

const DEFAULT_SYSTEM =
  "You are Quanta, the AI engine inside an AI-native Linux terminal. " +
  "Answer the user's question precisely and concisely (max ~120 words). " +
  "Plain text only — no markdown fences; use - bullets where helpful.";

const MAX_TURNS = 8;

export async function POST(req: NextRequest) {
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const question = (body.question ?? "").trim();
  if (!question) {
    return NextResponse.json({ ok: false, error: "question is required" }, { status: 400 });
  }
  if (question.length > 4000) {
    return NextResponse.json({ ok: false, error: "question too long (max 4000 chars)" }, { status: 400 });
  }

  const messages: ChatMessage[] = [
    { role: "system", content: (body.system ?? "").trim() || DEFAULT_SYSTEM },
  ];
  /* continuation context — last MAX_TURNS turns, size-capped */
  if (Array.isArray(body.history)) {
    for (const h of body.history.slice(-MAX_TURNS)) {
      if (!h || typeof h.content !== "string") continue;
      const role = h.role === "assistant" ? "assistant" : "user";
      messages.push({ role, content: h.content.slice(0, 2000) });
    }
  }
  messages.push({ role: "user", content: question });

  const result = await callProvider(
    (body.provider ?? "builtin").slice(0, 32),
    body.model?.slice(0, 120),
    messages,
  );
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false, error: result.error, provider: result.provider, model: result.model,
        timeMs: result.timeMs, attempts: result.attempts,
        fallbackFrom: result.fallbackFrom, fallbackError: result.fallbackError,
      },
      { status: 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    text: result.text,
    provider: result.provider,
    model: result.model,
    timeMs: result.timeMs,
    attempts: result.attempts,
    fallbackFrom: result.fallbackFrom,
    fallbackError: result.fallbackError,
  });
}
