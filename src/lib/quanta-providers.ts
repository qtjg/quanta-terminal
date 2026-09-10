/*
 * QUANTA multi-provider AI engine.
 *
 * One OpenAI-compatible adapter covers every hosted provider (OpenRouter,
 * Groq, Gemini, Cerebras); `builtin` uses the zero-config z-ai gateway and
 * `ollama` talks to a local runtime. All hosted providers read their key
 * from env — keys are NEVER echoed to the client, only their presence.
 *
 * Free-model catalogs are curated per provider (the `:free` tier on
 * OpenRouter, the always-free tiers on Groq/Gemini) so `model use` always
 * costs nothing when a free key is supplied.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderDef {
  id: string;
  label: string;
  kind: "builtin" | "openai-compatible" | "ollama";
  endpoint: string;
  keyEnv?: string;
  homepage: string;
  note: string;
  freeModels: string[];
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: "builtin",
    label: "Quanta Gateway (z-ai)",
    kind: "builtin",
    endpoint: "internal",
    homepage: "https://z.ai",
    note: "zero-config — always available, no key needed",
    freeModels: ["glm-4-flash (auto)"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai-compatible",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    keyEnv: "OPENROUTER_API_KEY",
    homepage: "https://openrouter.ai/keys",
    note: "aggregates 300+ models — big free tier (:free suffix)",
    freeModels: [
      "deepseek/deepseek-chat-v3-0324:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "qwen/qwen-2.5-72b-instruct:free",
      "google/gemma-3-27b-it:free",
      "mistralai/mistral-small-3.1-24b-instruct:free",
    ],
  },
  {
    id: "groq",
    label: "Groq",
    kind: "openai-compatible",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    keyEnv: "GROQ_API_KEY",
    homepage: "https://console.groq.com/keys",
    note: "fastest inference (LPU) — generous free tier",
    freeModels: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "gemma2-9b-it",
    ],
  },
  {
    id: "gemini",
    label: "Google AI Studio",
    kind: "openai-compatible",
    endpoint:
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    keyEnv: "GEMINI_API_KEY",
    homepage: "https://aistudio.google.com/apikey",
    note: "free tier via AI Studio key (OpenAI-compatible endpoint)",
    freeModels: ["gemini-2.0-flash", "gemini-2.5-flash"],
  },
  {
    id: "cerebras",
    label: "Cerebras",
    kind: "openai-compatible",
    endpoint: "https://api.cerebras.ai/v1/chat/completions",
    keyEnv: "CEREBRAS_API_KEY",
    homepage: "https://cloud.cerebras.ai",
    note: "wafer-scale speed — free tier available",
    freeModels: ["llama-3.3-70b", "llama3.1-8b"],
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    kind: "ollama",
    endpoint: "http://localhost:11434/v1/chat/completions",
    homepage: "https://ollama.com",
    note: "100% local & private — no key, needs ollama running with a model pulled",
    freeModels: ["llama3.2", "qwen2.5-coder", "phi4-mini"],
  },
];

export function findProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/* never leak key values — only whether they are configured */
export function providerStatus() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    keyEnv: p.keyEnv ?? null,
    hasKey: p.keyEnv ? Boolean(process.env[p.keyEnv]) : true,
    note: p.note,
    freeModels: p.freeModels,
    homepage: p.homepage,
  }));
}

/* per-attempt timeout; hosted worst case = 3 attempts + backoffs ≈ 47s (client aborts at 60s) */
const TIMEOUT_MS = 15_000;
const RETRIES = 2; // extra attempts after the first (hosted providers)
const BUILTIN_RETRIES = 1; // builtin gets 1 retry, no fallback (it IS the fallback)
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 4000;

/** pure retry backoff: attempt-0 → 500ms, 1 → 1s, capped at 4s; honors Retry-After (capped).
 *  exported for unit tests. */
export function backoffDelay(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs, MAX_DELAY_MS);
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
}

export interface ProviderCallResult {
  ok: boolean;
  text?: string;
  provider: string;          // provider that ACTUALLY served the answer (fallback target if fallback)
  model: string;
  error?: string;
  /* reliability telemetry — surfaced by ai/model/summarize frames in the terminal */
  timeMs?: number;           // wall time including retries + fallback
  attempts?: number;         // attempts made on the primary provider
  fallbackFrom?: string;     // set when the primary provider failed → builtin served
  fallbackError?: string;    // the primary provider's last error
}

/* one raw attempt against an OpenAI-compatible endpoint, classified for retry policy */
type Attempt =
  | { kind: "ok"; text: string }
  | { kind: "fatal"; error: string }                                       // no key / 401 / 400/404 → never retry
  | { kind: "transient"; error: string; retryAfterMs?: number };            // 429 / 5xx / network / timeout → retry

async function attemptHosted(
  provider: ProviderDef,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<Attempt> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider.kind === "openai-compatible") {
    const key = provider.keyEnv ? process.env[provider.keyEnv] : undefined;
    if (!key) {
      return {
        kind: "fatal",
        error: `${provider.keyEnv} not set — get a free key at ${provider.homepage} (try 'providers')`,
      };
    }
    headers.authorization = `Bearer ${key}`;
    /* OpenRouter etiquette headers */
    if (provider.id === "openrouter") {
      headers["HTTP-Referer"] = "https://quanta.terminal";
      headers["X-Title"] = "QUANTA terminal";
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(provider.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.4,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      /* OpenRouter & friends: {error:{message}} — extract the useful part */
      let detail = body.slice(0, 160);
      try {
        const j = JSON.parse(body) as { error?: { message?: string } | string };
        if (j.error) detail = (typeof j.error === "string" ? j.error : j.error.message ?? detail).slice(0, 160);
      } catch { /* body wasn't json — keep raw slice */ }
      if (res.status === 429 || res.status >= 500) {
        const ra = parseFloat(res.headers.get("retry-after") ?? "");
        return {
          kind: "transient",
          error: res.status === 429
            ? `rate-limited (429) — free tiers throttle${detail ? ` — ${detail}` : ""}`
            : `upstream error (HTTP ${res.status})${detail ? ` — ${detail}` : ""}`,
          retryAfterMs: Number.isFinite(ra) ? ra * 1000 : undefined,
        };
      }
      const hint =
        res.status === 401
          ? "key rejected (401) — check the env key"
          : res.status === 404
            ? `model not found (404) — see 'models ${provider.id}'`
            : `HTTP ${res.status}`;
      return { kind: "fatal", error: `${hint}${detail ? ` — ${detail}` : ""}` };
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return { kind: "transient", error: "empty completion" };
    return { kind: "ok", text };
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "AbortError"
        ? `timeout after ${TIMEOUT_MS / 1000}s`
        : e instanceof Error
          ? e.message
          : String(e);
    /* network failures & timeouts are the classic transient class */
    return { kind: "transient", error: msg };
  } finally {
    clearTimeout(timer);
  }
}

const BUILTIN_TIMEOUT_MS = 20_000; /* sdk has no native timeout — worst case 2×20s + backoff < 60s client abort */

async function callBuiltin(messages: ChatMessage[]): Promise<Attempt> {
  try {
    const { default: ZAI } = await import("z-ai-web-dev-sdk");
    const zai = await ZAI.create();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const completion = await Promise.race([
      zai.chat.completions.create({
        messages,
        thinking: { type: "disabled" },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${BUILTIN_TIMEOUT_MS / 1000}s (builtin gateway too slow)`)), BUILTIN_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!text) return { kind: "transient", error: "empty model response" };
    return { kind: "ok", text };
  } catch (e) {
    return { kind: "transient", error: `ai backend: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function callProvider(
  providerId: string,
  model: string | undefined,
  messages: ChatMessage[],
  opts?: { maxTokens?: number },
): Promise<ProviderCallResult> {
  const provider = findProvider(providerId) ?? findProvider("builtin")!;
  const chosenModel = model || provider.freeModels[0];
  const maxTokens = opts?.maxTokens ?? 700;
  const t0 = Date.now();

  /* ── builtin: zero-config z-ai gateway (1 retry, no fallback — it IS the fallback) ── */
  if (provider.kind === "builtin") {
    let last: Attempt = { kind: "transient", error: "untried" };
    for (let attempt = 0; attempt <= BUILTIN_RETRIES; attempt++) {
      last = await callBuiltin(messages);
      if (last.kind === "ok") {
        return {
          ok: true, text: last.text, provider: provider.id, model: "glm-4-flash",
          timeMs: Date.now() - t0, attempts: attempt + 1,
        };
      }
      if (attempt < BUILTIN_RETRIES) await new Promise((r) => setTimeout(r, backoffDelay(attempt)));
    }
    return {
      ok: false, provider: provider.id, model: chosenModel,
      error: last.error, timeMs: Date.now() - t0, attempts: BUILTIN_RETRIES + 1,
    };
  }

  /* ── hosted + local: retry loop with backoff, then automatic builtin fallback ── */
  let lastTransient: Attempt = { kind: "transient", error: "untried" };
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const attemptRes = await attemptHosted(provider, chosenModel, messages, maxTokens);
    if (attemptRes.kind === "ok") {
      return {
        ok: true, text: attemptRes.text, provider: provider.id, model: chosenModel,
        timeMs: Date.now() - t0, attempts: attempt + 1,
      };
    }
    if (attemptRes.kind === "fatal") {
      /* missing key / bad key / bad model — honest error, no retry, no fallback */
      return {
        ok: false, provider: provider.id, model: chosenModel,
        error: attemptRes.error, timeMs: Date.now() - t0, attempts: attempt + 1,
      };
    }
    lastTransient = attemptRes;
    if (attempt < RETRIES) {
      await new Promise((r) => setTimeout(r, backoffDelay(attempt, attemptRes.retryAfterMs)));
    }
  }

  /* all retries exhausted on transient errors → automatic builtin fallback */
  const fb = await callBuiltin(messages);
  if (fb.kind === "ok") {
    return {
      ok: true, text: fb.text, provider: "builtin", model: "glm-4-flash",
      timeMs: Date.now() - t0, attempts: RETRIES + 1,
      fallbackFrom: provider.id, fallbackError: lastTransient.error,
    };
  }
  return {
    ok: false, provider: provider.id, model: chosenModel,
    error: `${provider.id}: ${lastTransient.error}; builtin fallback also failed: ${fb.error}`,
    timeMs: Date.now() - t0, attempts: RETRIES + 1,
    fallbackFrom: provider.id, fallbackError: lastTransient.error,
  };
}
