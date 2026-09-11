# AI Routing (OmniRoute) — How the Terminal Picks a Brain

QUANTA never hardcodes a single AI vendor. Requests flow through a small routing layer
(`src/lib/quanta-omniroute.ts`) on top of a provider registry
(`src/lib/quanta-providers.ts`), with abuse protection from `src/lib/rate-limit.ts`.
This doc explains the real flow so contributors can extend it without guesswork.

## The registry

`quanta-providers.ts` defines every backend as data — id, endpoint, models, capabilities:

| id | Role |
|----|------|
| `builtin` | the default/bundled route (zero-config path) |
| `openrouter` | gateway to many upstream models |
| `groq` | fast inference for lightweight tasks |
| `gemini` | Google's endpoint |
| `cerebras` | ultra-low-latency inference |
| `ollama` | local models (privacy-first, offline) |

Adding a provider means adding an entry — not touching routing code. The registry also
carries the per-provider capability flags the router needs (streaming support, key
availability) so the browser client never needs to know where secrets live.

## Task classification

`classifyTask(prompt)` inspects the user's input and buckets it into one of:

```
"code" | "math" | "translate" | "summarize" | "general"
```

The classifier is deliberately cheap (no extra model call) and returns a `reason` string
that is surfaced in telemetry, so routing decisions are auditable rather than magic.

## Route tables

Two tables drive selection:

- `ROUTE_PREF` — preferred models per task type (code asks get code-strong models,
  translate asks get translation-friendly ones, and so on).
- `ROUTE_PROVIDER_ORDER` — the fallback chain across providers:
  `openrouter → groq → gemini → cerebras`.

`pickRoute(type, providers)` walks the chain and returns the first healthy
`{ provider, model, reason }` for the classified task. Health means: the provider is
configured (key present, or no key needed for local Ollama) and not rate-limited for
this session.

## Fallback & resilience

When a provider call fails (429/5xx), the router retries/falls through `ROUTE_PROVIDER_ORDER`
instead of surfacing an error to the prompt. The user sees a slower answer, not a dead
terminal. Rate limiting (`rate-limit.ts`) applies per session, in front of the server-side
proxy at `/api/quanta`, so runaway command loops can't burn a provider quota.

## Key hygiene

The browser never sees provider keys. The terminal client posts to `/api/quanta`; the
route handler injects credentials from server env, calls the provider, and streams a
normalized response back. This is why the registry is safe to expose in client bundles
minus secrets.

## Extending it

1. New provider → add to `quanta-providers.ts` (id, endpoint, models, caps).
2. New task type → extend the `TaskType` union, teach `classifyTask`, add a `ROUTE_PREF`
   entry.
3. New fallback behaviour → adjust `ROUTE_PROVIDER_ORDER` or the health check inside
   `pickRoute`.
4. Run `bun run lint && bun run test` — the suite mocks provider HTTP and asserts on
   routing decisions, so your change is covered end to end.
