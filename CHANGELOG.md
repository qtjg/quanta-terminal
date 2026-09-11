# Changelog

All notable changes to QUANTA are documented here. Versions follow semver.

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
