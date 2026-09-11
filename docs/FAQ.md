# FAQ

Quick answers to the questions that come up most in issues and chats.

## Is the terminal real or a simulation?

Real. Every one of the ~119 commands is implemented against the command engine and the
persistent virtual filesystem. There are no canned transcripts: if `grep` finds a match,
it is because the bytes are actually in a VFS file. The test suite enforces this by
asserting on real effects (see [DEVELOPMENT.md](./DEVELOPMENT.md)).

## Where is my data stored?

In your browser. The VFS, session state and history persist locally and are restored on
boot. The server does not host your files, and nothing leaves your machine unless you
explicitly run something that makes a network call (`curl`, AI commands, `ping`-style
utilities, etc.).

## Do my AI provider keys leak to the page?

No. Provider keys live in server-side environment variables only. Terminal AI calls go
through `/api/quanta`, which injects credentials, applies per-session rate limits, and
streams normalized chunks back. The browser never sees a raw key.

## Which AI providers are supported?

QUANTA's OmniRoute layer is provider-agnostic: Groq, OpenAI, OpenRouter, Z.ai and
local Ollama endpoints are wired through the registry in `src/lib/quanta-providers.ts`.
Adding a provider is a data change (id, base URL, models, capability flags), not a code
change. Requests can pin a provider with an `@provider` prefix or fall through the
fallback chain automatically on 429/5xx.

## How do I add a new command?

Pick the matching `cmd-*.ts` category module, implement against `fs.ts`/core, return
frames (never DOM), register it, add tests, regenerate `docs/COMMANDS.md`. The full
walk-through takes about five minutes and lives in
[DEVELOPMENT.md](./DEVELOPMENT.md#adding-a-command-the-5-minute-tour).

## Can I pipe everything?

Yes — that's the contract. Every command can act as a pipe stage; commands that don't
stream still return a single frame and compose with `grep`, `head`, `tail`, `wc`, etc.

## What is the rizz `extension/` about?

It's a companion browser extension with its own engine (`src/lib/rizz-*.ts` and
`/api/rizz` routes). It shares repo conventions and support tooling but intentionally
does not import the terminal UI tree, so the app bundle stays lean.

## Is there a CLI sibling?

Yes — [gitmancer](https://github.com/qtjg/gitmancer), a zero-dependency AI CLI agent for
code and GitHub workflows. It follows the same philosophy: real actions, confirmation
gates for mutations, no fake output.

## Why Bun for tests?

Bun's built-in test runner starts in milliseconds, which keeps the hundreds of engine/VFS
assertions in the fast inner loop where they actually get run. Node stays fully supported
for the production server path.

## Something broke — where do I report?

Open a GitHub issue with: the command you ran, the frames you got, what you expected,
and browser/OS. Security-sensitive reports: see [SECURITY.md](../SECURITY.md) — please
don't open public issues for vulnerabilities.
