# Changelog

All notable changes to QUANTA are documented here. Versions follow semver.

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
