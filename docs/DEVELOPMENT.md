# Development Guide

Everything you need to hack on QUANTA locally. For the big picture read
[ARCHITECTURE.md](./ARCHITECTURE.md) first; for the command catalog see
[COMMANDS.md](./COMMANDS.md).

## Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| Bun | ≥ 1.1 | dev server, test runner, script runner |
| Node.js | ≥ 20 | Next.js runtime requirement |
| A package manager | bun (recommended) | `bun.lock` is committed |

No database server is required for terminal development — the VFS is browser-local and the
AI plane talks straight to providers from route handlers.

## Setup

```bash
git clone https://github.com/qtjg/quanta-terminal.git
cd quanta-terminal
bun install
cp .env.example .env   # if you want live AI calls; terminal works without it
bun dev                 # http://localhost:3000
```

The dev script runs Next.js on port 3000 and tees output to `dev.log`:

```
bun run dev      # next dev -p 3000, logs → dev.log
```

## Scripts

| Script | What it does |
|--------|--------------|
| `bun run dev` | Next dev server on :3000 (tees to `dev.log`) |
| `bun run build` | production build + standalone bundle assembly |
| `bun run start` | serve the standalone production bundle |
| `bun run lint` | ESLint over the repo |
| `bun run test` | full suite via `scripts/test-quanta.ts` (engine, VFS, providers, satellites) |

## Test harness

All tests run through `bun scripts/test-quanta.ts`. The suite asserts **real effects**:

- command registry integrity (every registered command executes, help text present)
- VFS operations produce verifiable bytes/metadata
- pipeline semantics (`cat x | grep y | wc -l` composition)
- provider plumbing with mocked HTTP (routing, retries, streaming chunk reassembly)
- satellite pure logic (rizz engine guards, bot helpers)

Run a focused slice while iterating:

```bash
bun scripts/test-quanta.ts --filter fs
```

House rule: if you add a command, add at least one test that asserts its real output and
one that exercises it inside a pipeline. Regenerate the command catalog doc when the
registry changes:

```bash
bun scripts/enum-cmds.ts > /dev/null && python3 .zscripts/gen_commands_doc.py
```

## Project layout (contributor map)

```
src/app/                 Next.js App Router routes (page.tsx IS the terminal)
src/app/api/quanta/      server-side AI proxy + rate limiting (keys never reach the client)
src/app/api/rizz/        rizz companion API surface
src/components/quanta/   terminal UI + command engine + category modules (cmd-*.ts)
src/lib/                 provider registry, OmniRoute, security, rate limit, rizz engine
scripts/                 dev tooling (test runner, command catalog generator)
extension/               browser extension (separate build, shared concepts only)
telegram-bot/            Telegram surface (standalone runtime)
mini-services/           small single-purpose services
docs/                    contributor + user documentation
tests/                   environment/build helper scripts
```

## Conventions

- **Commits**: conventional commits (`feat:`, `fix:`, `docs:`, `perf:`, `chore:` …).
  Keep one logical change per commit — the history is a changelog.
- **Branches**: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`.
- **Identity**: commits should carry your normal git identity; the repo owner merges via
  squash or merge-commit, both fine.
- **TypeScript**: strict mode is on; do not weaken types to make the compiler quiet.
- **Lint before push**: `bun run lint` must be clean; CI runs it again.
- **No canned output**: never hardcode outputs to make a test pass — assert real effects.

## Adding a command (the 5-minute tour)

1. Pick the right category module in `src/components/quanta/` (or open a new `cmd-*.ts`
   if you're adding a family — then register it in `commands.ts`).
2. Implement the command against `fs.ts` / core utilities; return frames, never DOM.
3. Export it from the registry with a one-line description (it feeds `man` and
   tab-completion for free).
4. Add tests (direct + pipeline), regenerate `docs/COMMANDS.md`.
5. `bun run lint && bun run test` — green, then PR.

## Release flow

1. Bump `package.json` version (semver; the app is pre-1.0 — breaking VFS changes bump minor).
2. `bun run build && bun run start`, smoke-test boot, one AI call, one pipeline.
3. Full suite green, then tag `vX.Y.Z` and push.
