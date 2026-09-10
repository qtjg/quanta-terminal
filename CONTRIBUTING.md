# Contributing to QUANTA

First off — thank you for considering a contribution. QUANTA has one hard rule that sets its bar: **nothing is faked**. Every command really runs against the virtual filesystem, every AI round-trip really hits the provider, and every failure is reported honestly. Keep that bar and your PR is already half-way.

## Development setup

```bash
git clone https://github.com/qtjg/quanta-terminal.git
cd quanta-terminal
bun install
bun run dev          # http://localhost:3000 — the root route IS the terminal
```

| Check | Command | Expectation |
|-------|---------|-------------|
| Tests | `bun run test` | all assertions pass, no skipped suites |
| Lint | `bun run lint` | zero errors |
| Types | `bunx tsc --noEmit` | zero errors |
| CI | GitHub Actions | lint + typecheck on every push |

## Adding a command

1. Pick the right module: `cmd-core.ts` (shell), `cmd-fs.ts` (filesystem), `cmd-text.ts` (text/data), `cmd-sys.ts` (system/network), `cmd-dev.ts` (dev tools), `cmd-fun.ts` (fun), `cmd-sec.ts` (security). AI commands live behind the OmniRoute layer (`src/lib/quanta-omniroute.ts`).
2. Register it in the command table with an honest `man` page entry.
3. **Ship real assertions** in `scripts/test-quanta.ts` — cover the happy path, at least one failure path, and (if relevant) pipe in/out behavior.
4. Update the command catalog: `bun scripts/enum-cmds.ts` and refresh the README section + `docs/COMMANDS.md` if counts change.
5. Bump the changelog (`CHANGELOG.md`) under an *Unreleased* heading.

## Ground rules

- **No mock data pretending to be live.** If a command needs the network and it's unavailable, say so in the output.
- **No secrets, ever.** API keys belong in `.env` (gitignored). The CI runs on a secretless tree — keep it that way.
- **Honest telemetry.** Token counts, latencies and provider names in AI output must be real measurements.
- **Atomic commits.** One logical change per commit; `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `ci:` prefixes.
- **TypeScript strict.** No `any` escapes without a comment explaining why.

## Submitting

1. Fork / branch from `main` (`feat/<topic>`, `fix/<topic>`, `docs/<topic>`).
2. Make your change with tests.
3. Run the full check table above.
4. Open a PR describing *what* and *why*; link any related issue.

New ideas that fit the product's "real terminal in the browser" philosophy are welcome — check the issue tracker for roadmap items marked `enhancement`.
