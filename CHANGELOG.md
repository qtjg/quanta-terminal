# Changelog

All notable changes to QUANTA are documented here. Versions follow semver.

## [Unreleased]

### Added — Ops tooling
- `scripts/healthcheck.sh` — production-style local probe (`OK 200` / `DOWN <code>`) with clean exit codes; `npm run healthcheck`
- `scripts/contrib-stats.sh` — per-author commit stats from the GitHub API (login + email breakdown, graph-rules reference); `npm run contrib-stats`
- `scripts/verify-attribution.sh` — flags default-branch commits whose author/committer email does not match the linked identity
- `scripts/sync-check.sh` — one-line local/origin drift verdict (SYNCED / AHEAD / BEHIND / DIVERGED) for multi-workflow safety
- `scripts/repo-audit.sh` — runs the ops trio (sync → attribution → app health) as a single report
- `scripts/healthcheck.test.sh` — shell self-test covering 200 / 500 / dead-port / bad-arg paths
- `package.json` now declares `engines` (node ≥ 18) and `contributors`

### Added — Documentation wave
- `docs/ARCHITECTURE.md` — deep-dive on the engine layers, VFS, OmniRoute routing plane and security plane, with contributor-oriented invariants (no canned output, pipeline contract)
- `docs/DEVELOPMENT.md` — setup, scripts, test harness guide, project layout map, command-authoring walkthrough and release flow
- `docs/AI-ROUTING.md` — how OmniRoute classifies tasks (`code`/`math`/`translate`/`summarize`/`general`), walks `ROUTE_PROVIDER_ORDER`, and keeps provider keys server-side
- `docs/KEYBINDINGS.md` — the real input-handler bindings (`Enter`, `↑/↓`, `Tab`, `Ctrl-L`, `Ctrl-C`) and their semantics
- `docs/FAQ.md` — answers for data storage, key hygiene, providers, piping and the satellite projects
- `ROADMAP.md` — living roadmap (shipped / next / mid-term / satellites / community / non-goals), merged via PR #11

### Changed
- README now cross-links the project docs next to the table of contents

## [0.7.1] — 2026-09-11

### Fixed — RizzReply quota-proofing (v0.10.2 brain)
- **Model rotation**: every AI attempt now rides a different gateway model slot (sticky preference for the last slot that served); if per-model quota buckets exist this multiplies effective capacity, and it costs nothing when the bucket is global
- Failure copy now tells the truth: retries across all model slots (~4 min of invisible patience) before surfacing an error
- New `x-rizz-ai-model` response header (which slot served) alongside `x-rizz-ai-retries`

## [0.7.0] — 2026-09-11

The "automation" release: **2 new commands** (117 → 119) — a real scripting engine and a filesystem time machine — plus PWA installability on mobile.

### Added — Scripting
- `script` — run real `.qsh` command files from the VFS: one command per line, `#` comments, `$VAR` expansion via `export`, pipes/redirects work per line
- `script demo` — generates + runs a sample script; `script list` — finds `.qsh` in cwd/home/~/scripts
- Stop-on-error by default (honest `N ok, M failed` footer), `script run -k <file>` keeps going, nesting capped at depth 2, 200-command cap per file

### Added — Filesystem
- `snapshot` — save/restore point-in-time copies of the whole VFS: `save [name]` (auto-name, 5-slot FIFO cap), `list`, `restore <name>`, `rm <name>`
- Restore always injects an auto `pre-restore-*` safety snapshot into the restored world (undo-safe), corrupt dumps are rejected, 2 MB size guard
- Snapshot dumps exclude `/var/snapshots` itself — snapshots never nest (prevents exponential dump growth)

### Added — PWA
- Web manifest (`/manifest.webmanifest`) + SVG icons (any + maskable) — QUANTA now installs to home screen / desktop as a standalone app
- `apple-web-app` meta: capable, black-translucent status bar

### Changed
- Test suite pacing is adaptive (waits only the remaining gap since the last LLM call); `QUANTA_TEST_PACE_MS` env override for fast runs — full suite drops from ~12 min to ~2.5 min
- README: 119-command catalog, scripting/snapshot/PWA feature rows, roadmap tick (scriptable scripts)

### Fixed
- Snapshot cap eviction comparator was unstable for same-second timestamps (could evict the wrong slot)

## [0.6.0] — 2026-09-10

The "power tooling" release: **32 new commands** (85 → 117), a new **dev tools** category, and full test coverage for every addition.

### Added — Dev Tools (new category)
- `pw` — crypto-grade password generator (`crypto.getRandomValues`, unambiguous alphabet, `--count`, `--no-symbols`)
- `base` — number-base conversion across bin/oct/dec/hex with strict digit validation
- `ts` — epoch ↔ date converter (s and ms, both directions, ISO out)
- `color` — hex/rgb/hsl interconversion with WCAG contrast ratios and AA/AAA grading
- `csv` — real RFC-4180 parser (quoted fields, escaped quotes) → aligned table or JSON objects
- `cron` — cron expression explainer: field expansion + next 3 real run times

### Added — Text & Data
- `json` — validate, pretty-print, keys, dot-path get/type
- `slug`, `wordfreq`, `pad`, `lorem`, `expand`, `fold`, `shuf`, `yes`, `seq`, `factor`, `strdist`

### Added — Filesystem
- `basename`, `dirname`, `realpath`, `split`, `fsck`

### Added — System & Network
- `tz` — real time across timezones via `Intl`
- `cal` — month calendar with leap-year handling
- `headers`, `isup` — real HTTP header inspection and availability checks

### Added — Security & AI
- `entropy` — Shannon entropy analysis (revives the quanta-sec lib)
- `translate` — AI translation into any language via OmniRoute

### Changed
- Help card and slash hints include the new `dev` category
- README command catalog refreshed (117 commands, dev tools section)
- CI runs lint + typecheck on every push (GitHub Actions)

### Fixed
- `expand` `-w` flag parsing
- Missing dependency declarations (`lucide-react`, `tailwindcss-animate`) — fresh clones now build

## [0.5.0] — 2026-09-09

- Initial public release: 85 commands, OmniRoute multi-provider AI, security toolkit, persistent VFS, professional README with real test screenshots.

## [0.4.x] — internal

- VISIT TOKYO decoupled and removed from the product; QUANTA became the sole focus.
