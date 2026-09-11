# QUANTA — Architecture Deep-Dive

This document expands on the summary in the [README](../README.md#-architecture) and is aimed at
contributors who want to understand **how the pieces fit together** before changing them.
QUANTA is a single Next.js (App Router) application, but internally it is layered like a small
operating system: a UI shell, a command engine, a persistent virtual filesystem, an AI routing
plane, and a security plane — plus satellite projects (browser extension, Telegram bot,
mini-services, Android packaging) that speak to the same core concepts.

```
┌────────────────────────────────────────────────────────────────────┐
│  Browser                                                           │
│  ┌────────────────────┐   keystrokes   ┌────────────────────────┐  │
│  │ Terminal UI        │ ────────────► │ Command Engine         │  │
│  │ (terminal.tsx)     │ ◄──────────── │ (core.ts + commands.ts)│  │
│  └────────────────────┘   frames      └───────┬────────────────┘  │
│                                               │                   │
│        ┌─────────────────────┬────────────────┼──────────────┐    │
│        ▼                     ▼                ▼              ▼    │
│  ┌──────────┐        ┌────────────┐   ┌──────────────┐ ┌────────┐ │
│  │ VFS      │        │ AI Plane   │   │ Sec Plane    │ │ Net    │ │
│  │ fs.ts    │        │ omniroute  │   │ quanta-sec   │ │ fetch  │ │
│  └──────────┘        └─────┬──────┘   └──────────────┘ └────────┘ │
└────────────────────────────┼───────────────────────────────────────┘
                             │ POST /api/quanta (server-side proxy)
                      ┌──────▼───────┐
                      │ Route handlers│──► Groq / OpenAI / OpenRouter /
                      │ (api/quanta)  │    Z.ai / Ollama … provider APIs
                      └───────────────┘
```

## 1. UI shell — `src/app` + `src/components/quanta/terminal.tsx`

The root route (`src/app/page.tsx`) **is** the terminal — there is no marketing landing page
between the user and the prompt. The terminal component owns four concerns:

- **Input state machine**: line editing, history navigation, tab completion, Ctrl-C/Ctrl-L
  handling, and the modal states for anything that needs multi-line input.
- **Frame renderer**: output is an append-only list of frames (prompt echoes, command stdout,
  AI answer blocks, tables, error cards). Rendering is intentionally dumb — every frame is
  data, so tests can assert on frames instead of DOM scraping.
- **Focus management**: keeps keyboard focus on the hidden input, forwards paste events,
  and handles mobile soft-keyboard quirks.
- **Boot sequence**: restores session state (VFS root handle, env, history tail) before the
  first prompt is drawn.

`src/app/terminal/` and `src/app/rizz/` are secondary routes: the first hosts standalone
terminal experiments, the second is the surface for the rizz companion project whose engine
also lives in this repo (`src/lib/rizz-*.ts`).

## 2. Command engine — `core.ts`, `commands.ts`, `cmd-*.ts`

The engine is a classic **parse → resolve → execute → render** pipeline:

| Stage | Where | Notes |
|-------|-------|-------|
| Tokenize & expand | `core.ts` | quotes, globs, `$VAR` expansion, alias substitution |
| Pipe assembly | `core.ts` | each stage becomes a generator; stdout streams between stages |
| Dispatch | `commands.ts` | registry lookup, man-page resolution, suggest-on-typo |
| Execution | `cmd-*.ts` | category modules, one file per family |
| Render | engine → UI | commands return frames; they never touch the DOM |

Category modules keep the registry flat and greppable:

- `cmd-core.ts` — shell primitives (`cd`, `echo`, `export`, `alias`, `history`, `man` …)
- `cmd-fs.ts` — VFS operations (`ls`, `cp`, `mv`, `find`, `grep`, `tree` …)
- `cmd-dev.ts` — developer utilities (`json`, `base64`, `hash`, `cron`, `uuid` …)
- `cmd-sec.ts` — security toolkit (hashing, encoding checks, password tools …)
- `cmd-sys.ts` — session/system introspection (`ps`, `env`, `uptime`, `telemetry` …)
- `cmd-text.ts` / `text-tools.ts` — text transforms (`tr`, `sort`, `uniq`, `wc` …)
- `cmd-fun.ts` — the fun ones (they still respect the pipeline contract)

Two invariants hold for every command:

1. **No canned output.** A command that claims to list files must read the VFS; a command
   that claims to hash must hash. The test suite enforces this by asserting on real effects.
2. **Pipeline contract.** Every command can be a pipe stage. Commands that can't sensibly
   stream still return a single frame and compose with `head`/`tail`/`grep`.

## 3. Persistent virtual filesystem — `fs.ts`

The VFS is a real tree (directories, regular files, metadata) that survives reloads. It is
not a toy string map: path resolution, permission-ish checks, and large-file guards live in
`fs.ts`, and every `cmd-fs.ts` entry point goes through it. Persistence strategy favours
**browser-local durability first** (session restore on boot), with the server never needing
to host user files — which keeps the app stateless and privacy-friendly.

The VFS is also the integration point that makes QUANTA feel like a machine rather than a
chat: `curl > file`, then `grep`, then `wc` all operate on the same bytes.

## 4. AI plane — `quanta-omniroute.ts`, `quanta-providers.ts`

OmniRoute is the multi-provider router:

- **Provider registry** (`quanta-providers.ts`): id, base URL, model list, capability flags
  (streaming, tools), and the request/response shapes. Adding a provider is a data change,
  not a code change.
- **Routing policy** (`quanta-omniroute.ts`): picks a provider per request (explicit
  `@provider` prefix, fallback chain, retry with backoff on 429/5xx, streaming pass-through).
- **Server-side proxy**: browser code never holds provider keys. Terminal AI calls go to
  `/api/quanta`, which injects credentials server-side, applies rate limits
  (`src/lib/rate-limit.ts`), and normalizes streaming chunks back to the UI.

This is the same shape gitmancer (the CLI sibling project in this org) uses on the terminal,
so behaviours learned in one surface transfer to the other.

## 5. Security plane — `quanta-sec.ts`, `rate-limit.ts`

- **Key hygiene**: provider keys exist only in server env; API responses never echo them.
- **Rate limiting**: per-session token buckets protect the proxy from runaway loops.
- **Input guardrails**: the security toolkit commands (`cmd-sec.ts`) and the lib-level
  checks validate hashes, encodings and secrets without ever shipping raw secrets to a
  provider unless the user explicitly asks for an AI call.

## 6. Satellite projects

| Path | What it is | Talks to core via |
|------|------------|-------------------|
| `extension/` | rizz browser extension (post/reply engine) | its own engine in `src/lib/rizz-*.ts` + `/api/rizz` routes |
| `telegram-bot/` | Telegram surface for QUANTA utilities | shared command concepts, standalone runtime |
| `mini-services/` | small single-purpose services | HTTP, same repo conventions |
| `android/`, `apkbuild/` | Android packaging experiments | wraps the web app |
| `telesupport/` | Telegram support tooling | standalone |

Each satellite is **intentionally decoupled**: it may reuse concepts and small helpers but
must not import the terminal UI tree, so the app bundle stays lean.

## 7. Testing & CI

- `bun scripts/test-quanta.ts` runs the suite (hundreds of tests covering engine, VFS,
  AI-plane plumbing with mocked providers, and satellites' pure logic).
- `.github/workflows/ci.yml` lints and typechecks every push.
- The contract for new code: **tests assert real effects** (VFS bytes, frame payloads,
  registry entries), never implementation details.

## 8. Design principles (the short list)

1. Real over fake — if a command says it, it does it.
2. Browser-first durability — user data stays user-side until explicitly sent somewhere.
3. Provider-agnostic AI — one routing plane, many backends, zero key exposure.
4. Composability — everything is a pipe stage; every frame is data.
5. Satellites stay small and decoupled — the terminal is the product.
