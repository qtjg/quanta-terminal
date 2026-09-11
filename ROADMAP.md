# QUANTA Roadmap

Living document. Checked items ship; everything else is ranked intent, not a promise.
Community input welcome — open an issue to claim or challenge an item.

## ✅ Shipped (highlights)

- 119-command engine: pipes, aliases, env, man pages, tab completion
- Persistent virtual filesystem with session restore
- OmniRoute multi-provider AI plane (Groq / OpenAI / OpenRouter / Z.ai / Ollama) with
  fallback chains, retry/backoff and streaming
- Security toolkit + server-side key isolation + per-session rate limits
- rizz browser extension (post/reply engine) and Telegram surfaces
- Android packaging experiments (`android/`, `apkbuild/`)
- CI (lint + typecheck) and a real-effects test suite

## 🎯 Next (in flight / near term)

- [ ] **Command palette** — fuzzy finder over the registry (feeds off man pages)
- [ ] **Tabs & split panes** — parallel sessions sharing one VFS
- [ ] **Theme engine** — token-based themes, import/export presets
- [ ] **VFS export/import** — portable archives (tar-like) in and out of the browser

## 🧭 Mid term

- [ ] **AI tool-calling commands** — model-initiated multi-step flows with confirmation
      gates (parity with gitmancer's agent loop)
- [ ] **Local model profiles** — first-class Ollama configs (endpoint, model, caps) in UI
- [ ] **VFS on IndexedDB** — larger quotas, migration from current storage
- [ ] **Command timing/telemetry panel** — real latency and provider stats per call

## 🛰 Satellites

- [ ] Extension: store listing polish + options page parity
- [ ] Telegram bot v2: shared command registry subset, inline mode
- [ ] Android: stable channel APK from the standalone build

## 🤝 Community

- [ ] `good first issue` curation + contributor guide link from issue templates
- [ ] Screenshots/demo GIF refresh for the README

## Non-goals

- No server-side user file hosting (privacy stance)
- No fake/canned command output — ever
- No auto-posting/auto-engagement loops in satellites (platform-ban and consent risk)
